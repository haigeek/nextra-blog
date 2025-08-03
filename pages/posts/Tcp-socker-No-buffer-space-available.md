---
title: 一次Tcp端口耗尽引发的思考
date: 2019-05-08 22:38:38
tag: Tcp, Socket
catrgories: 计算机基础
---
tcp在实际的使用中，客户端和服务端可能都会出现端口不够用的情况，重新温习了一下tcp的四次挥手来寻找这个问题出现的原因。
<!--more-->

# 一次Tcp端口耗尽引发的思考

## 起因

访问接口服务端既不报错但是也无响应，登录服务器查看后台有报错，报错的堆栈的信息大致为：

```java
Caused by: java.net.SocketException: No buffer space available (maximum connections reached?): connect
at org.apache.axis.AxisFault.makeFault(AxisFault.java:101)
at org.apache.axis.transport.http.HTTPSender.invoke(HTTPSender.java:154)
at org.apache.axis.strategies.InvocationStrategy.visit(InvocationStrategy.java:32)
at org.apache.axis.SimpleChain.doVisiting(SimpleChain.java:118)
at org.apache.axis.SimpleChain.invoke(SimpleChain.java:83)
at org.apache.axis.client.AxisClient.invoke(AxisClient.java:165)
at org.apache.axis.client.Call.invokeEngine(Call.java:2784)
at org.apache.axis.client.Call.invoke(Call.java:2767)
at org.apache.axis.client.Call.invoke(Call.java:2443)
at org.apache.axis.client.Call.invoke(Call.java:2366)
at org.apache.axis.client.Call.invoke(Call.java:1812)
```

## 问题分析

从报错信息来看是socket端口使用数已经超过了最发限度，定位到应该是服务器的原因，尝试请求这台服务器部署的其他应用，对于的后台也会报相同的错误。基本可以定位到是因为可用的socket端口不足的原因。

那么为什么会出现这个情况呢？

出现这种情况，我们可以使用命令 `netstat -at` 来查看一下当前系统下端口的连接状况，可以发现此时会有很多的端口会处于TIME_WAIT的状态，处于这个状态的端口是无法释放的，因此系统并发过大，连接数过多，部分socket连接无法释放关闭，而持续请求又导致无法释放的socket连接不断积压，最终导致No buffer space available。

我们重新来温习一下TCP连接的三次握手和挥手

### TCP连接的三次握手和挥手

#### 三次握手

![](https://haigeek.me:8443/pic?ossId=2025/06/15/akyU7GwuMEoQ64N-20250615183012857.png)

tcp的三次握手的流程如下：

1. 客户端发送SYN标志位为1，seq（Sequence Number）为x的连接请求报文，然后客户端进入SYN_SEND状态，等待服务器端的确认响应。

2. 服务端收到客户端的请求，对这个SYN报文进行确认，发送ACK（Acknowledgment Number）为x+1（Sequence+1），SYN和ACK的标志位均为1，seq为y的报文段为y的报文段（即SYN+ACK的报文段），此时服务端进入SYN_RECV状态

3. 客户端收到服务器的SYN+ACK报文段，确认ACK后，发送ACK为y+1，SYN标志位为0，ACK标志位为1的报文段，发送完成后，客户端和服务器端都进入ESTABLISHED状态，完成TCP三次握手，客户端和服务器端成功地建立连接，可以开始传输数据了。

#### 四次挥手

![tcp-bye](https://haigeek.me:8443/pic?ossId=2025/06/15/2iUhyBfPW7duI8V.png)

tcp的四次挥手的流程如下：

连接可以由客户端或者服务端发起，这里以客户端发起为例：

1. 客户端发送Seq为x+2，Ack为y+1的FIN报文段，客户端进入FIN_WAIT_1状态，即告诉服务端没有数据需要传输了，请求关闭连接；
2. 服务端收到客户端的FIN报文段后，向客户端应答一个Ack为Seq+1（即x+3）的ACK报文段，即告诉客户端你的请求我收到了，但是我还没准备好，请等待我的关闭请求。客户端收到后进入FIN_WAIT_2状态；
3. 服务端完成数据传输后向客户端发送Seq为y+1的FIN报文段，请求关闭连接，服务器进入LAST_ACK状态；
4. 客户端收到服务端的FIN报文段后，向服务端应答一个Ack为Seq+1的ACK报文段，然后客户端进入TIME_WAIT状态；服务端收到客户端的ACK报文段后关闭连接进入CLOSED状态，客户端等待2MSL（2 Max Segment Lifetime）后依然没有收到回复，则证明服务端已正常关闭，客户端此时关闭连接进入CLOSED状态。

### 为什么有TIME_WAIT的状态

1. 确保最终的ACK已经到达；

   假如最终的ACK丢失，那么服务端会重新发送FIN，当最终的ACK在1个MSL没有到达，那么在下一个MSL里重新发送的FIN需要到达，客户端必须维护TCP状态信息以便可以重发最终的ACK，否则会发送RST，结果服务端认为发生错误。

2. 防止延迟的无效消息包被误认为是合法的

   假如客户端A和服务端B在传输数据，假如传输了一节数据，因为网络的原因发生了延迟，在未到达B的时候，AB就已经关闭了传输通道。然后AB马上又重新建立起一个相同的IP地址和端口之间的TCP连接，那么这个延迟的数据包是有可能重新到达的，这样就引起了混乱。处于TIME_WAIT的端口是不允许创建新的连接的，2MSL可以保证这个丢失的数据可以失效。

在centos下可以使用 `sysctl -a|grep net.ipv4.tcp_fin_timeout` 查看超时时间

```
net.ipv4.tcp_fin_timeout = 60
```

### 本地有多少端口可用

TCP协议中 `PORT` 部分是用两个字节来表示的，也就是说可用的端口数量肯定不能超过65536个。
另外，这其中还有些端口是系统保留的，需要root权限才可以使用的，在CentOS系统中，client端可以使用的端口可以通过 `sysctl -a|grep net.ipv4.ip_local_port_range` 来查看

```shell
net.ipv4.ip_local_port_range = 32768	60999
```

### 单机请求的QPS

如果client机器有32768端口可用，TIME_WAIT 60秒，短连接的方式发起请求，那么这个client发起的请求的QPS是不能超过28233/60的

## 问题解决

以下设置需要根据Windows和linux系统使用对应的命令去设置。

1. 解决问题最快的方式是重启服务器，可以释放大量的端口，但是弊端也比较明显
2. 检查代码中webservice或httpclient调用未进行连接释放，导致资源无法回收。
3. 修改系統默认的TIMEOUT时间
4. 打开`tcp_tw_reuse`也就是允许将TIME-WAIT sockets重新用于新的TCP连接，打开这个选项之后，TCP包里面会带上发包机器的当前时间戳

windows 系统处理方式

通过regedit启动注册表编译器找到如下路径：

```
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters
```

添加参数：

(1)新建

值名称：MaxUserPort

值类型：DWORD

值数据：65534（十六进制是FFFE）

有效范围：5000 - 65534 (十进制)

默认：0x1388 5000（十进制）

(2)新建

值名称：TCPTimedWaitDelay

值类型：DWORD

值数据：0000001e（30） 
