> 作者：deepseek，binaf
>
> 本文章仅用于学习研究，禁止用于非法用途
>
> 所有偏移以 arm64-v8a lib为准

## 结论摘要

| 层 | 位置 | 作用 | 抛异 |
|---|---|---|---|
| 本地校验 | `libnedat.so` `DatManager::init` | 比较 dat 文件中的 RSA 明文与当前证书派生值 | logcat: `java.lang.RuntimeException: RSA初始化失败: DatManager create error: sign 验证不正确` |
| 服务端校验 | 每个URS请求的 `packageSign` 字段 | 服务端与注册的官方签名值比对 | 登录时toast提示：`请求失败，请稍后重试(14009)` |

其两层要分别处理：

1. `libnedat.so` `0x49140`：将判断改成无条件走成功分支
2. `libursandroidunity.so` `0xdb4c`：让 `NativeJni.getSignatureMd5Bytes` 返回官方证书的 `md5_2` 字节`51 DA 8B 04 EA 71 F3 FD AF 1C 5F 14 AF 13 76 81`，使URS请求里的 `packageSign` 恢复为服务端注册值`5D80E7FFA151A1781AB4A13DFCF4F361`


## 实际流程
### 本地校验

APK重新签名，应用启动到初始化阶段即崩溃，从logcat中可见：

```text
java.lang.RuntimeException: RSA初始化失败: DatManager create error: sign 验证不正确
```
追及本地java调用链后，发现如下：
```text
com.netease.urs.f4.onPreModuleLaunch()
    └─ new com.netease.urs.e4(...)
         └─ DatManager.create(context, "app_sign_private.dat", "<productId>_app_sign_private", uRSConfig.getAppSign())
              ├─ importDat(...)
              ├─ nativeCreateDatManager()
              └─ nativeInit(...)
```
这就意味着`DatManager.create()` 会把异常重新包装，但是真正校验在native层，接下来我们来到对应的`libnedat.so`，发现内有如下相关函数和方法
- `DatManager_init`
- `DatManager::init`
- `GetDataStringFromDatFileInternal`
- `getSignaturesString`
- `getSignatureMd5Bytes`
- `getSignatures`
- `signatureToMd5`
- `DecryptByPrivateKey`
- `JNIExceptionHelper::throwJNIException`

（至于为什么列出这么多是因为后文会用得到）

其中`getSignatures`最终还是通过安卓提供的`PackageManager`api获取当前安装包签名：

```text
PackageManager.getPackageInfo(packageName, 0x40).signatures
```

然后进行`Signature.toByteArray()`得到证书DER，再继续计算后面的值

在库里搜索`"sign 验证不正确"`，这个字符串只有一处引用，上下文如下：

```asm
0x4913c: bl   strcmp
0x49140: cbz  w0, #0x4917c     ; strcmp == 0 才跳成功
0x49144: adrp x1, #0xb6000
0x49148: add  x1, x1, #0x481   ; "sign 验证不正确"
...
0x4917c: mov  w19, #1          ; initialized = true
0x49180: strb w19, [x20, #8]
```
如同

```c
if (strcmp(expected, actual) != 0) {
    throwJNIException("sign 验证不正确");
    return false;
}

initialized = true;
```

所以这层签名校验已经基本清楚了：当前安装包的证书重新计算出来的值不与DAT里的预期值一致

现在只需要把这个判断改成无条件走成功分支即可(`0x49140: b #0x4917c`)

patch后的so文件：[libnedat_patched.so](/resources/libnedat_patched.so)
### 服务端校验
现在我们已经有一个重新签名的去除应用签名校验的安装包了，但使用此安装包登录时，意料之内的事情发生了：
用邮箱登录时toast提示：`请求失败，请稍后重试(14009)`

java层里面能找到对应关系：

```java
put(14009, 445);
```

注意URS请求构造过程，可以看到`com.netease.urs.v3.a`：

```java
jSONObjectG.put("packageSign", u1VarE.d());
```

那么问题就出现在这个`packageSign`身上，接下来我们追踪这个`d()`方法

来到`com.netease.urs.e4.d`, 得到以下关系

```text
NativeJni.getSignatureMd5Bytes(APPLICATION_CONTEXT, false)
   ↓
byte[]
   ↓
e4.a(byte[])
   ↓
32 位 Hex
   ↓
packageSign
```

`NativeJni`的native方法位于`libursandroidunity.so`, JNI符号：`Java_com_netease_urs_jni_NativeJni_getSignatureMd5Bytes @ 0xdb4c`

我们来到`libursandroidunity.so`，得到如下：

``` text
cert_der
 ↓
MD5
 ↓
md5_1 (16 字节)
 ↓
hex_high_low(md5_1)
 ↓
32 个十六进制字符
 ↓
+"!#Urs_Salt#!"
 ↓
MD5
 ↓
md5_2 (16 字节)
 ↓
JNI 返回 Java byte[]
```

而在这里，网易大神的工程师采取了一个刁钻的hex算法`hex_high_low(md5_1)`，个人猜测是为了增加逆向过程中的干扰因素

等价代码：

```java
byte[] out = new byte[data.length * 2];
int i = 0;
int j = data.length;
while (i < data.length) {
    out[i] = HEX[(data[i] >> 4) & 0xF];   //高半字节放在前半段
    out[j] = HEX[data[i] & 0xF];          //低半字节放在后半段
    i++;
    j++;
}
return new String(out);
```

先回到本地校验

`DatManager::init`先用`DECRYPT`解`assets/app_sign_private.dat`（实际上这一段流程是`DatManager.importDat()`先把 asset中的dat复制到
`files/nedat/<productId>_app_sign_private`, `nativeInit`再对这个已保存的文件调用`DATENC::DatEncrypt::getDataFromDatFile`），得到一段 base64的PKCS#8 RSA私钥，然后拿它去解密`appSign`

而`appSign`的常量在`com.netease.gl.serviceaccount.b`里：

```java
public static final String MKEY_URS_APK_SIGN = "PQrTza19...";  // product: mtoken_client
public static final String GL_URS_APK_SIGN   = "SVBNFicl...";  // product: godlike_app
```
两段都是256字节RSA密文的base64

用dat里的私钥进行`RSA/none/PKCS1Padding`解密后，两个常量得到同一个值：
 `5D80E7FFA151A1781AB4A13DFCF4F361`

这个值与DAT中的`expected`一致

这里，网易大神的工程师犯了一个巨大的错误，`DatManager::init`会把解出来的私钥以error级别打印到logcat中：

```text
E NEDat: private key MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk...
```

但因为logcat单行有长度限制，这条会被截断，但PKCS#8 DER的前段已经包含了 `n``e``d` 三个关键参数

不需要CRT参数，直接用原始RSA运算即可：

```python
m = pow(int.from_bytes(ciphertext, "big"), d, n)
pt = m.to_bytes(256, "big")          # PKCS#1 v1.5: 00 02 PS 00 M
assert pt[:2] == b"\x00\x02"
msg = pt[pt.index(b"\x00", 2) + 1:]
```
解出来的`msg`就是`5D80E7FFA151A1781AB4A13DFCF4F361`

对于`libursandroidunity.so`直接将其开头替换成固定桩即可

桩的逻辑：

```asm
stp  x29, x30, [sp, #-0x30]!
mov  x29, sp
stp  x19, x20, [sp, #0x10]
mov  x19, x0                  ; JNIEnv*

ldr  x8, [x19]
ldr  x8, [x8, #0x580]         ; NewByteArray
mov  w1, #0x10                ; 16 字节
blr  x8
mov  x20, x0                  ; jbyteArray

; 把 md5_2 写到栈缓冲 [sp+0x20]
; 51 DA 8B 04 EA 71 F3 FD AF 1C 5F 14 AF 13 76 81
movz w8, #0xda51
movk w8, #0x048b, lsl #16
str  w8, [sp, #0x20]
...
movz w8, #0x13af
movk w8, #0x8176, lsl #16
str  w8, [sp, #0x2c]

mov  x0, x19
mov  x1, x20
mov  w2, #0
mov  w3, #0x10
add  x4, sp, #0x20
ldr  x8, [x19]
ldr  x8, [x8, #0x680]         ; SetByteArrayRegion
blr  x8

mov  x0, x20                  ; 返回 byte[]
ldp  x19, x20, [sp, #0x10]
ldp  x29, x30, [sp], #0x30
ret
```
patch后的so文件：[libursandroidunity_patched.so](/resources/libursandroidunity_patched.so)

## FridaHook脚本
``` javascript
/*
 * Godlike / com.netease.gl v4.24.1 签名校验绕过 Frida Hook By Deepseek
 *
 * 用法：
 *   frida -U -f com.netease.gl -l frida_godlike_sign_bypass.js --no-pause
 *
 * 说明：
 *   - 本地校验发生在启动早期，建议用 spawn 模式（-f），不要 attach 到已启动的进程。
 *   - 所有偏移只适用于 com.netease.gl v4.24.1 arm64-v8a
 *   - 本脚本仅用于学习研究。
 */

"use strict";

const CFG = {
    // 服务端注册的官方签名值（由 app_sign_private.dat 中的 RSA 私钥解出）
    officialSign: "5D80E7FFA151A1781AB4A13DFCF4F361",

    // 官方签名值对应的 md5_2 字节（非交错 Hex 解码）
    md5_2: [
        0x51, 0xDA, 0x8B, 0x04, 0xEA, 0x71, 0xF3, 0xFD,
        0xAF, 0x1C, 0x5F, 0x14, 0xAF, 0x13, 0x76, 0x81
    ],

    // libnedat.so v4.24.1
    initSymbol: "_ZN5nedat10DatManager4initEP7_JNIEnvP8_jstringS4_P8_jobject",
    initVaddr: 0x48F90,
    branchVaddr: 0x49140,
    origInsn: 0x340001E0,     // cbz w0, #0x4917c  (E0 01 00 34)
    patchedInsn: 0x1400000F   // b   #0x4917c      (0F 00 00 14)
};

let libnedatPatched = false;
let initHookInstalled = false;

/* ------------------------------------------------------------------ */
/* 1. 本地校验：libnedat.so 0x49140 -> b #0x4917c                      */
/* ------------------------------------------------------------------ */

function patchNedatAt(addr, reason) {
    if (libnedatPatched) return;
    try {
        const cur = addr.readU32();
        if (cur === CFG.patchedInsn) {
            libnedatPatched = true;
            console.log("[=] libnedat 已经是补丁状态");
            return;
        }
        if (cur !== CFG.origInsn) {
            console.log("[!] libnedat 指令不匹配 @" + addr +
                        " = 0x" + cur.toString(16) + " (" + reason + ")");
            return;
        }
        Memory.patchCode(addr, 4, function (code) {
            code.writeU32(CFG.patchedInsn);
        });
        libnedatPatched = true;
        console.log("[+] libnedat 本地校验已绕过 @" + addr + " (" + reason + ")");
    } catch (e) {
        console.log("[-] patch libnedat 失败: " + e);
    }
}

function installInitHook(initAddr) {
    if (initHookInstalled) return;
    initHookInstalled = true;

    const delta = CFG.branchVaddr - CFG.initVaddr; // 0x1B0
    Interceptor.attach(initAddr, {
        onEnter: function () {
            // 在函数真正执行到 0x49140 之前把分支改掉
            patchNedatAt(initAddr.add(delta), "DatManager::init onEnter");
        }
    });
    console.log("[+] DatManager::init hook @" + initAddr);
}

function onLibnedatLoaded(module) {
    if (!module || module.name !== "libnedat.so") return;

    console.log("[+] libnedat.so 已加载: " + module.base);
    patchNedatAt(module.base.add(CFG.branchVaddr), "module loaded");

    const initAddr = Module.findExportByName("libnedat.so", CFG.initSymbol);
    if (initAddr) {
        installInitHook(initAddr);
    } else {
        console.log("[!] 未找到 DatManager::init 导出，依赖已加载时打的补丁");
    }
}

// Frida 16.1+ 支持模块观察者，加载即回调
if (Process.attachModuleObserver) {
    Process.attachModuleObserver({
        onAdded: function (module) {
            if (module.name === "libnedat.so") onLibnedatLoaded(module);
        }
    });
}

// 兼容旧版 Frida：轮询等待 libnedat.so
(function pollLibnedat() {
    const module = Process.findModuleByName("libnedat.so");
    if (module) {
        onLibnedatLoaded(module);
        return;
    }
    setTimeout(pollLibnedat, 100);
})();

/* ------------------------------------------------------------------ */
/* 2. 服务端 packageSign：hook e4.d()，失败则回退 NativeJni            */
/* ------------------------------------------------------------------ */

function installJavaHooks() {
    Java.perform(function () {
        let tries = 0;

        (function tryHook() {
            // 优先：直接让 e4.d() 返回官方值
            try {
                const e4 = Java.use("com.netease.urs.e4");
                e4.d.implementation = function () {
                    return CFG.officialSign;
                };
                console.log("[+] e4.d hook 已安装 -> " + CFG.officialSign);
                return;
            } catch (e) {
                console.log("[-] e4.d hook 失败: " + e);
            }

            // 回退：让 NativeJni 返回 md5_2 字节，e4.a([B) 会编码成官方值
            try {
                const NativeJni = Java.use("com.netease.urs.jni.NativeJni");
                NativeJni.getSignatureMd5Bytes
                    .overload("android.content.Context", "boolean")
                    .implementation = function (ctx, flag) {
                        const signed = CFG.md5_2.map(function (x) {
                            return x > 127 ? x - 256 : x;
                        });
                        console.log("[+] NativeJni.getSignatureMd5Bytes -> md5_2");
                        return Java.array("byte", signed);
                    };
                console.log("[+] NativeJni hook 已安装（fallback）");
                return;
            } catch (e2) {
                console.log("[-] NativeJni hook 失败: " + e2);
            }

            if (++tries < 50) {
                setTimeout(tryHook, 100);
            } else {
                console.log("[-] Java hook 放弃：类可能尚未加载或已被混淆");
            }
        })();
    });
}

installJavaHooks();

```