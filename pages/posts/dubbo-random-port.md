---
title: Dubbo Rpc 使用随机端口
date: 2020-04-01 23:17:02
tag: dubbo
---

dubbo在进行服务间通信的时候需要使用端口进行通信, 但是这个端口的指定规则是什么。

<!--more-->

## 随机端口生成方式

查看源码定位到dubbo获取端口的方法在 `doExportUrlsFor1Protocol`

此方法中关于端口的代码如下：

```java
//从dubbo:protocol标签中读取port配置 
Integer port = protocolConfig.getPort();
//如果有provider标签配置，且protocol中port配置为null 或者 0，则直接使用provider中的port端口
        if (this.provider != null && (port == null || port == 0)) {
            port = this.provider.getPort();
        }
//根据协议类型获取默认端口号（默认端口为20880）
        int defaultPort = ((Protocol)ExtensionLoader.getExtensionLoader(Protocol.class).getExtension(name)).getDefaultPort();
//如果配置port为null或者0，则会使用默认端口
        if (port == null || port == 0) {
            port = defaultPort;
        }
//如果配置port为null或者小于0（例如-1）则使用自动端口
        if (port == null || port <= 0) {
          //获取随机端口，从缓存中取
            port = getRandomPort(name);
          	//如果获取端口为空，则以默认端口为基准，按顺序取最近一个可用的端口
            if (port == null || port < 0) {
                port = NetUtils.getAvailablePort(defaultPort);
              //添加到随机端口的port的map
                putRandomPort(name, port);
            }

            logger.warn("Use random available port(" + port + ") for protocol " + name);
        }
```

进一步查看NetUtils.getAvailablePort(defaultPort)方法，代码如下：

```java
public static int getAvailablePort(int port) {
        if (port <= 0) {
            return getAvailablePort();
        } else {
            for(int i = port; i < 65535; ++i) {
                ServerSocket ss = null;
				//循环创建端口，假如端口被占用抛出异常并继续循环
              	//当获取到可用端口后返回
                try {
                    ss = new ServerSocket(i);
                    int var5 = i;
                    return var5;
                } catch (IOException var13) {
                } finally {
                    if (ss != null) {
                        try {
                            ss.close();
                        } catch (IOException var12) {
                        }
                    }

                }
            }

            return port;
        }
    }

```

查看使用了哪些端口

```
lsof -i|grep 5083(dubbo服务进程)|grep LISTEN 
```

## 使用固定还是随机

需要注意的是，dubbo文档的推荐用法指出：

> 使用固定端口暴露服务，而不要使用随机端口
>
> 这样在注册中心推送有延迟的情况下，消费者通过缓存列表也能调用到原地址，保证调用成功。

我理解的场景是假如我们使用随机端口，启动了提供者，假如我们使用随机端口，随机到的端口20880, 那么注册中心提供给消费者的端口为20080；当我们因为要更新提供者，并将提供者重启并使用了随机端口的方式，那么这次端口为30080，因为注册中心通知延迟，可能使用30080的提供者已经启动完毕，但是消费者没有收到通知，所以依然使用缓存的20080调用就会出错。

那么使用固定端口20080就不会有这个问题。

但是考虑实际场景和配置的复杂度，我们对接口调用的实时性应该是没有这么高的。

假如后期使用了容器化，每个dubbo应用作为一个容器的话，端口问题也可以得到比较好的解决。
