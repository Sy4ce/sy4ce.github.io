> 作者：Fandet
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
strcmp(expected, actual)

cbz  w0, success

; 不相等
throwJNIException("sign 验证不正确")

success:
mov  w19, #1
strb w19, [x20,#8]
```

如同

```c
if (strcmp(expected, actual) != 0) {
    throwJNIException("sign 验证不正确");
}

initialized = true;
```

所以这层签名校验已经基本清楚了：当前安装包的证书重新计算出来的值不与DAT里的预期值一致

现在只需要把这个判断改成无条件走成功分支即可


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

`NativeJni` 加载了`libursandroidunity.so`, JNI符号：`Java_com_netease_urs_jni_NativeJni_getSignatureMd5Bytes @ 0xdb4c`

我们来到`libursandroidunity.so`，得到如下：

``` text
cert_der
 ↓
MD5
 ↓
md5_1 (16 bytes)
 ↓
hex_high_low(md5_1)
 ↓
32 bytes
 ↓
+"!#Urs_Salt#!"
 ↓
MD5
 ↓
md5_2 (16 bytes)
 ↓
JNI 返回 Java byte[]
```




---
---



