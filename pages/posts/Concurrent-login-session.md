---
title: 并发登录下session的处理
date: 2019-10-16 23:26:39
tag: session, spring
categories: [spring]
hide_toc: true/Users/haigeek/dev/project/hugo/haigeek-blog/content/posts/computerscience/Tcp-socker-No-buffer-space-available.md
---

在进行性能测试的时候并发请求登录接口时候出现失败的情况，对排查记录做一下总结。

<!--more-->

# 并发登录下session的处理

## 问题

在进行性能测试的时候并发请求登录接口，除登录接口之外的接口保护策略是使用过滤器从cookie获取用户信息并和服务端进行后续的数据交互。

设置一个线程组，线程主要有两个接口

1. 登录接口，登录成功之后系统会返回一个set-cookie的响应头
2. 调用被保护的接口，接口在请求时会携带cookie来让服务器鉴别当前请求是否合法

线程组的具体设置如下：

![image-20190925090956992](https://i.loli.net/2019/12/23/ZKRoBQOF3mna4rd.png)

标记为3 的接口访问进行了用户鉴权。

当执行此线程组一次的时候，运行正常，运行结果如下：

![image-20190924231443836](https://i.loli.net/2019/12/23/GZJfDqMyQnEYVB8.png)

将线程组的线程数调整为2，Rame-Up（线程启动时间间隔）设置为1s，两组线程执行正常，运行结果如下：

![image-20190925091109920](https://s2.loli.net/2022/12/24/SaeMhTqpGtWzQC1.png)

可以看到执行顺序是按照我们1、2、3依次执行的顺序，因为1s的间隔较长，在线程1执行完毕之后线程2执行。

将线程组的线程数调整为2，Rame-Up（线程启动时间间隔）设置为0.1s，接口请求出现异常，运行结果如下：

![image-20190925091517378](https://s2.loli.net/2022/12/24/FqWciCT8SyNpdkY.png)

在这次请求可以看到，两个线程同时出发，模拟了系统可以存在的并发情况，可以确认的是第二个用户的确登录成功但是在与后台进行校验的时候出现了问题。

## 分析

通过报错的接口的异常信息定位到代码的位置是在从session中取用户信息的时候出现了错误。

![image-20190925092015591](https://s2.loli.net/2022/12/24/qIUNv1gCSjBc7nx.png)

框选的代码为报错行，联系上下文猜测session并没有获取成功或session不存在。因此加入箭头所指代码进行debug。

发现在此处会报空指针异常，但是session是确实存在的。

检查redis中存储的session信息，发现有一个session缺少要存储的用户等关键信息

不完整的session信息：

![不完整session](https://s2.loli.net/2022/12/24/OPQzvkhIlVrwZWR.png)

存储正常的session信息：

![image-20190925092738929](https://s2.loli.net/2022/12/24/cfnIAq1gQChoLG4.png)

因此定位到是session在存储的时候出了问题。

## 解决

检查session存储的代码，发现登录接口使用的session是一个共享的变量，因为 spring 的每个 controller 默认都是单例的，这个session 会被其他线程给共享，在多线程的情况下，极容易出现线程不安全的问题。

现有的session处理方式如下：

```java
private HttpSession session;
private HttpServletRequest request;

@ModelAttribute
public void init(HttpSession httpSession, HttpServletRequest request) {
	this.session = httpSession;
	this.request = request;
}
//登录controller
 @PostMapping(value = "public/client-account/v1/login-dev")
@ApiOperation(value = "用户登录校验(明文)")
public ResponseData loginDev(@RequestBody OmsLoginDTO loginDTO) throws Exception {
  OmsUserVO omsUserVO = this.userFacade.checkLogin(loginDTO, false);
  this.userFacade.log(omsUserVO, request);
  sessionCache(omsUserVO, session);
  return ResponseUtil.success(omsUserVO);
}
/**
     * 缓存用户session
     *
     * @param omsUserVO
     * @throws Exception
     */
private void sessionCache(OmsUserVO omsUserVO) throws Exception {
  if (repeatLogin.equals("true")) {
    httpSession.setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, omsUserVO.getLoginName());
  }
  httpSession.setAttribute("user", JSONObject.toJSONString(omsUserVO));
  if (null != omsUserVO.getRoles() && omsUserVO.getRoles().size() > 0) {
    List<String> roleNameList = omsUserVO.getRoles().stream()
      .map(OmsRoleVO::getRoleName)
      .collect(Collectors.toList());
    session.setAttribute("role", JSONObject.toJSONString(roleNameList));
  }
}
```

解决方式有三种：

首先介绍最简单的一种，

#### 使用@Autowired注解

使用@Autowired代替@ModelAttribute

```java
@Autowired
private HttpServletRequest request;
@Autowired
private HttpSession session;
    
//@ModelAttribute
//public void init(HttpSession httpSession, HttpServletRequest request) {
  //this.session = httpSession;
  //this.request = request;
//}
```

对上述代码进行调试

![image-20190925110213553](https://s2.loli.net/2022/12/24/K8FQeTgMwufvoil.png)

加上了@Autowired注解之后进行debug发现，request并不是原始的HttpServletRequest对象，而是HttpServletRequest的一个代理类。找到代理类的实现如下

![image-20190925110822925](https://s2.loli.net/2022/12/24/HIjl3nckNPm8Ddw.png)

实际上Autowire进来的并不是原始的HttpServletRequest对象，而是HttpServletRequest的一个代理类。实际上它会通过

```
((ServletRequestAttributes) RequestContextHolder.getRequestAttributes()).getRequest()
```

到这一步骤已经很明显了，那如何看出是线程安全的，继续往下看。

![image-20190925110859572](https://s2.loli.net/2022/12/24/SvHB7gA4CbhTNMt.png)

进一步去看RequestContextHolder发现RequestContextHolder是通过ThreadLocal来实现的，可以保证每个线程获取得到的Request对象一定是当前请求的Request对象，从而保证线程安全。

![image-20190925111025094](https://s2.loli.net/2022/12/24/7bu9BqrfIQxmLjo.png)

#### 一种是在登录相关接口将session作为参数传递到方法中使用

在请求和存储的时候加上单独的HttpSession session

```java
@PostMapping(value = "public/client-account/v1/login-dev")
@ApiOperation(value = "用户登录校验(明文)")
public ResponseData loginDev(@RequestBody OmsLoginDTO loginDTO,HttpSession httpSession) throws Exception {
  OmsUserVO omsUserVO = this.userFacade.checkLogin(loginDTO, false);
  this.userFacade.log(omsUserVO, request);
  sessionCache(omsUserVO, httpSession);
  return ResponseUtil.success(omsUserVO);
}

/**
     * 缓存用户session
     *
     * @param omsUserVO
     * @throws Exception
     */
private void sessionCache(OmsUserVO omsUserVO) throws Exception {
  if (repeatLogin.equals("true")) {
    session.setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, omsUserVO.getLoginName());
  }
  session.setAttribute("user", JSONObject.toJSONString(omsUserVO));
  if (null != omsUserVO.getRoles() && omsUserVO.getRoles().size() > 0) {
    List<String> roleNameList = omsUserVO.getRoles().stream()
      .map(OmsRoleVO::getRoleName)
      .collect(Collectors.toList());
    session.setAttribute("role", JSONObject.toJSONString(roleNameList));
  }
}
```

#### 另外一种是将session使用ThreadLocal来处理

重点在于session的初始化设置

```java
private static final ThreadLocal<HttpSession> session = new ThreadLocal<>();
@ModelAttribute
public void init(HttpSession httpSession, HttpServletRequest request) {
  ClientAccountController.session.set(httpSession);
  this.request = request;
}
//在涉及到session的获取时候需要使用session.get()
/**
     * 缓存用户session
     * @param omsUserVO
     * @throws Exception
     */
private void sessionCache(OmsUserVO omsUserVO) throws Exception {
  if (repeatLogin.equals("true")) {
    session.get().setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, omsUserVO.getLoginName());
  }
  session.get().setAttribute("user", JSONObject.toJSONString(omsUserVO));
  if (null != omsUserVO.getRoles() && omsUserVO.getRoles().size() > 0) {
    List<String> roleNameList = omsUserVO.getRoles().stream()
      .map(OmsRoleVO::getRoleName)
      .collect(Collectors.toList());
    session.get().setAttribute("role", JSONObject.toJSONString(roleNameList));
  }
}
```

使用上述三种方式任意方式之后，最终请求正常

![image-20190925094039469](https://s2.loli.net/2022/12/24/lo4m7psr3f2AM96.png)

继续调整请求线程为10，问题没有出现。

## 总结

1、在并发的情况下要注意考虑共享变量的问题

2、request、Response、session在单例controller是不安全的，采用ThreadLocal可以解决该问题。推荐直接使用spring帮助我们处理好的来使用。

3、建议修改现有的baseController。

参考链接：

> https://www.cnblogs.com/kismetv/p/8757260.html#t4
>
> https://segmentfault.com/q/1010000005139036
