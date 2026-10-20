
> 本文章仅用于学习研究，禁止用于非法用途
>
> 所有偏移以 arm64-v8a lib为准

## 1. 结论摘要

应用实际有**两层**签名校验，且都围绕 APK 签名证书：

| 层 | 位置 | 作用 | 失败表现 |
|---|---|---|---|
| 本地启动校验 | `libnedat.so` `DatManager::init` | 比较 dat 文件中的 RSA 明文与当前证书派生值 | `RSA初始化失败: DatManager create error: sign 验证不正确` |
| 服务端 URS 校验 | 每个 URS 请求的 `packageSign` 字段 | 服务端与注册的官方签名值比对 | `445请求失败，请稍后重试[14009]` |

两层要分别处理：

1. `libnedat.so` `0x49140`：把本地比较后的“失败分支”改成无条件走成功分支；
2. `libursandroidunity.so` `0xdb4c`：让 `NativeJni.getSignatureMd5Bytes` 返回**官方证书**的 `md5_2` 字节，使 URS 请求里的 `packageSign` 恢复为服务端注册值。

最终值：

```
packageSign = 5D80E7FFA151A1781AB4A13DFCF4F361
md5_2 bytes = 51 DA 8B 04 EA 71 F3 FD AF 1C 5F 14 AF 13 76 81
```

## 2. 错误码与现象

### 2.1 本地校验失败

```
RuntimeException: RSA初始化失败: DatManager create error: sign 验证不正确
```

调用链：

```
com.netease.urs.f4.onPreModuleLaunch()
  └─ new com.netease.urs.e4(...)
       └─ com.netease.android.dat.library.DatManager.create(
              context, "app_sign_private.dat",
              "<productId>_app_sign_private", uRSConfig.getAppSign())
            ├─ importDat(asset → files/nedat/…)
            ├─ nativeCreateDatManager()
            └─ nativeInit(datPath, appSign, context, nativePtr)
```

`DatManager.create` 捕获所有异常后包装成 `DatManager create error: …`，`e4` 构造器再包装成 `RSA初始化失败: …`。

### 2.2 服务端校验失败

```
"reason":"445请求失败，请稍后重试[14009]"
```

客户端映射在 `com.netease.loginapi.f$k`：

```java
put(14009, 445);
```

即 SDK 码 `14009` ↔ 服务端 `result=445`（package error）。服务端拒绝后，`appId` 缓存为空，登录请求无法继续。

## 3. Java 调用链

```
f4.onPreModuleLaunch
  └─ new e4(context, null, keeper, URSConfig)
       ├─ DatManager.create(...)              // 本地 dat 校验
       └─ this.j = r0.b(...)                  // LocalDataEncryptor

URS 请求构建 (com.netease.urs.v3.a)：
  jSONObjectG.put("packageSign", u1VarE.d());
  ...
  q0 q0VarF = u1VarE.f(jSONObjectG.toString());   // SM4 加密 p1
```

- `u1.d()` 的实现只有 `e4` / `f4`（`f4` 委托 `e4`）；
- `e4.d()`：

```
NativeJni.getSignatureMd5Bytes(APPLICATION_CONTEXT, false)
  → Object（byte[]）
  → e4.a(byte[]) → 32 位 Hex 字符串
```

- `NativeJni` 加载 `libursandroidunity.so`，JNI 符号：
  `Java_com_netease_urs_jni_NativeJni_getSignatureMd5Bytes @ 0xdb4c`。

## 4. Native 调用链（libnedat.so）

| 符号 / 地址 | 作用 |
|---|---|
| `DatManager_init` `0x49448` | JNI 入口，空指针检查 |
| `DatManager::init` `0x48f90` | 本地签名校验主流程 |
| `GetDataStringFromDatFileInternal` `0x48aa4` | 解密 `app_sign_private.dat` → RSA 私钥 |
| `getSignaturesString` `0x49f80` | 计算“实际签名值” |
| `getSignatureMd5Bytes` `0x4a0cc` | 证书 MD5 → 盐 → 二次 MD5 |
| `getSignatures` `0x4a3b8` | `PackageManager.getPackageInfo(pkg, 0x40).signatures` |
| `signatureToMd5` `0x4a580` | `Signature.toByteArray()` → MD5 |
| `DecryptByPrivateKey` `0x48178` | Base64 + PKCS#8 + RSA 解密 appSign |
| `JNIExceptionHelper::throwJNIException` `0x49afc` | `ThrowNew(JNIException, msg)` |

错误字符串 `"sign 验证不正确"` 位于 `.rodata 0xb6481`，全库唯一引用：

```
0x49140: cbz  w0, #0x4917c     ; strcmp == 0 → 成功
0x49144: adrp/add x1, "sign 验证不正确"
0x49150: throwJNIException(...)
0x4917c: mov w19,#1
0x49180: strb w19,[x20,#8]     ; initialized = true
```

即：`strcmp(expected, actual) != 0` 才会走到抛异常分支。

## 5. packageSign 算法

### 5.1 实际值（客户端）

来源：`PackageManager.getPackageInfo(packageName, GET_SIGNATURES=0x40)` → `signatures[0]` → `Signature.toByteArray()`（证书 DER）。

```
md5_1 = MD5(cert_der)
buf   = hex_high_low(md5_1) + "!#Urs_Salt#!"
md5_2 = MD5(buf)
actual = hex_high_low(md5_2)
```

**关键：`hex_high_low` 是非交错布局**：

```text
前 16 个字符 = 16 个字节的高半字节（bytes[0..15] >> 4）
后 16 个字符 = 16 个字节的低半字节（bytes[0..15] & 0xF）
```

等价伪代码：

```python
s = ''.join(table[b >> 4] for b in data) + ''.join(table[b & 0xF] for b in data)
```

> 这是整个排查中最大的坑。常见的 `data.hex().upper()` 是交错的
> （高/低、高/低…），会得到错误值。例如把官方值 `5D80E7…` 当作字节再编码，
> 会得到 `58EFA5…`。

### 5.2 期望值

- `appSign` 常量：
  - `MKEY_URS_APK_SIGN`（product `mtoken_client`）
  - `GL_URS_APK_SIGN`（product `godlike_app`）
  - 定义于 `classes6.dex`：`com.netease.gl.serviceaccount.b`
  - 均为 256 字节 RSA 密文的 Base64（RSA-2048）
- 解密：
  - 私钥来自 `assets/app_sign_private.dat`（DATENC 加密），由 `DatManager::init` 解出；
  - `Base64.decode(appSign)` → `RSA/None/PKCS1Padding` 解密 → 32 位 ASCII 值。
- 两个常量解密结果相同：

```
5D80E7FFA151A1781AB4A13DFCF4F361
```

- 其对应的 16 字节 `md5_2`（非交错解码）：

```
51 DA 8B 04 EA 71 F3 FD AF 1C 5F 14 AF 13 76 81
```

### 5.3 私钥提取（复现用）

`DatManager::init` 会以 **ERROR** 级别打印解出的私钥：

```
E NEDat: private key MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk...
```

- 日志会被 logcat 截断（约 1011 字符），但 PKCS#8 DER 前段已包含 `n`、`e`、`d`；
- 解析截断 DER 取 `n/e/d`，用 RSA 原始运算解密即可：

```python
m = pow(int.from_bytes(ciphertext, 'big'), d, n)
m_bytes = m.to_bytes(256, 'big')          # PKCS#1 v1.5: 00 02 PS 00 M
```

## 6. 最小补丁

### 6.1 libnedat.so

| 项 | 值 |
|---|---|
| 文件 | `lib/arm64-v8a/libnedat.so` |
| vaddr / file offset | `0x49140`（该 ELF `.text` 的 vaddr == file offset） |
| 原指令 | `cbz w0, #0x4917c`，字节 `E0 01 00 34` |
| 补丁后 | `b #0x4917c`，字节 `0F 00 00 14` |
| 效果 | `strcmp` 结果被忽略，`DatManager::init` 直接设置 `initialized=1` 并返回 true |

### 6.2 libursandroidunity.so
| 项 | 值 |
|---|---|
| 文件 | `lib/arm64-v8a/libursandroidunity.so` |
| vaddr / file offset | `0xdb4c` |
| 函数 | `Java_com_netease_urs_jni_NativeJni_getSignatureMd5Bytes` |
| 改动 | 用 132 字节桩替换函数开头，忽略参数，返回固定 byte[16] |

桩的 ARM64 逻辑（示意）：

```asm
stp  x29, x30, [sp, #-0x30]!
mov  x29, sp
stp  x19, x20, [sp, #0x10]
mov  x19, x0                  ; JNIEnv*
ldr  x8, [x19]
ldr  x8, [x8, #0x580]         ; NewByteArray
mov  w1, #0x10
blr  x8
mov  x20, x0                  ; jbyteArray

; 写 16 字节到栈缓冲 [sp+0x20]
; 51 DA 8B 04 EA 71 F3 FD AF 1C 5F 14 AF 13 76 81
movz/movk + str 四组

mov  x0, x19
mov  x1, x20
mov  w2, #0
mov  w3, #0x10
add  x4, sp, #0x20
ldr  x8, [x19]
ldr  x8, [x8, #0x680]         ; SetByteArrayRegion
blr  x8

mov  x0, x20
ldp  x19, x20, [sp, #0x10]
ldp  x29, x30, [sp], #0x30
ret
```
## 7. 重新签名

这里就没有啥好说的了