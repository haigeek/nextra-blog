---
title: Jenkins部署项目到远程windows
date: 2019-01-01 22:54:58
tag: jenkins
---

核心是使用ssh进行jenkins主节点与目标部署服务器进行通信, 文件传输走scp协议, 执行执行使用ssh命令远程到目标主机进行执行.
<!--more-->

# Jenkins部署项目到远程windows

使用ssh进行jenkins主节点与目标部署服务器进行通信, 文件传输走scp协议, 执行执行使用ssh命令远程到目标主机进行执行.

## ssh调用命令脚本

使用ssh命令远程服务器进行脚本调用的时候的流程是:

1. 在本级ssh到目标主机
2. 调用目标主机的脚本启动tomcat,假如我们调用的是bin目录下startup.bat
3. 本机的终端窗口有输出,远程主机的tomcat启动成功
4. 关闭本级的ssh终端
5. 远程的tomcat随之关闭

## 要解决的问题

### **ssh调用的进程的生命周期问题**

查阅资料发现

![image-20190704223510253.png](https://s2.loli.net/2022/12/24/RSt43Z2rHJxyqBL.png)

针对上述情况在linux下的解决方案很多, 这里描述下winsows的解决方案.

在这个[回答](https://stackoverflow.com/questions/3382082/whats-the-nohup-on-windows)下, 采取了将tomcat做成Windows服务的方式, 问题得到解决, 具体的配置方式如下:

#### 设置tomcat的环境变量

下载安装版的Windows版tomcat, 在bin目录下分别为server.bat、startup.bat、shutdown.bat设置环境变量, 如下所示

![image-20190704224910131.png](https://s2.loli.net/2022/12/24/zDkqpmhANiVUSwv.png)

#### 将tomcat注册为服务

进入bin文件夹下执行

service install 服务名称

![[图片上传中...(image-20190704230244896.png-4869a1-1562942345129-0)]
](https://s2.loli.net/2022/12/24/1U8BFIoHsxwm4Xi.png)

#### 服务的启动与停止

```
net stop server-name
net start server-name
```

![image-20190704230244896.png](https://s2.loli.net/2022/12/24/uXMvU1ZebLsGHoc.png)

将这两条指令做成bat脚本, 放在bin目录下, 供之后jenkins直接调用.

![image-20190704230544740.png](https://s2.loli.net/2022/12/24/EfkJxQhyedWLj1H.png)

### jenkins的终端输出乱码

在linux下远程调用Windows的终端的时候, 在jenksin的控制台总是乱码. 查阅资料多数是说设置Jenkins的编码为U8, 但是我安装的jenkins本身设置就是U8, 后来发现在远程调用的bat脚本第一行设置为

```
chcp 65001
```

表示切换到utf-8模式即可, 之后输出默认为英文且不会再乱码.

### 是否有必要每次重启Tomcat

#### 场景

在实际使用的过程中, 每次部署假如都需要重启tomcat的话使得整个系统变得不稳定, 那么是否每次更新都要重启tomcat呢?

首先我描述一下我遇到的一个问题, 在jenkins中设置了一个重启tomcat的脚本, 脚本如下:

```
pipeline {
    environment {
        // 部署远程主机ip地址,需要通过密钥的方式设置免密登录
        remoteIp = "127.0.0.1"
        remotePort='22'
        // 失败通知Email
        email = "test@haigeek.cn"
        // 远程tomcat位置(windows要使用/来表示路径)
        tomcatPath = "E:/tomcat/apache-tomcat-8.5"
        tomcatPathDisk = "E:"
    }
    agent any
    tools {
        maven 'maven-3.6.1'
    }
    stages {
        stage('Deploy') {
            steps {
                withEnv(['JENKINS_NODE_COOKIE=dontKillMe']) {
                    sh '''
                        export BUILD_ID=dontKillMe
                        echo "开始使用scp传输文件"
                        echo "开始调用远程tomcat进行重启"
                        ssh  -p ${remotePort} administrator@${remoteIp} "cd ${tomcatPath}/bin && ${tomcatPathDisk} && restart"
                    '''
                }
            }
        }
    }
}
```

上面的脚本核心功能就是调用远程tomca下的restart脚本来重启动tomcat, 因为使用net stop tomcat 来关闭tomcat需要比较长时间, 加上我们tomcat上运行的是dubbo项目, 因此我直接使用taskkill的方式, 根据dubbo端口来杀进程, 结论是每次都可以成功杀死进程并重启tomcat, 如下图, kill的脚本如下:

```
@echo off
chcp 65001
REM 设置dubbo端口号
 set port=30109
 for /f "tokens=5" %%i in ('netstat -aon ^| findstr ":%port%"') do (
    set n=%%i
 )
 taskkill /pid %n% -F
```

jenkins的输出如下:

![image-20190712221521459.png](https://s2.loli.net/2022/12/24/hznKDZfcUkq1bwS.png)

但是当我将这个脚本集成在完整的pipeline中, 会出现taskkill失败的情况, 报错为**PIDxxx为系统进程, 无法杀死**.

#### 分析

分析了一下, 唯一不同的是我在杀死tomcat之前将最新打包出的war包移动到了tomcat下, 此时tomcat开始自动解压并重新部署, 注意**此时进程已经不是tomcat的进程id, 而是切换为系统的进程**.

在后期的测试中发现war包可以自动帮助我们热更新, 这个功能可以大大减少我们更新的速度.

#### 解决

解决方法很简单, 将kill tomcat的指令放在移动war包之前, 不再报错.

## 完整Pipeline

```
// 持续集成脚本，勿动

pipeline {
    environment {
        // 部署远程主机ip地址,需要通过密钥的方式设置免密登录
        remoteIp = "127.0.0.1"
        remoteName = "administrator"
        remotePort='22'
        // 远程tomcat位置(使用/来表示路径)
        tomcatPath = "C:/tomcat/apache-tomcat-8"
        tomcatPathDisk = "C:"
    }
    agent any
    tools {
        maven 'maven-3.6.1'
    }
    stages {
         stage('pullcode'){
            steps{
                git branch: 'dev', credentialsId: 'xxx', url: 'http://xxx.git'
            }
        }

        stage('Build') {
            steps {
                sh '''
                    echo "开始编译打包过程"
                    echo "PATH = ${PATH}"
                    echo "M2_HOME = ${M2_HOME}"
                    mvn clean && mvn package -DskipTests=true
                '''
            }
        }
          stage('Test'){
            steps {
                sh 'echo "Test stage"'
            }
        }

        stage('Deploy') {
            steps {
                withEnv(['JENKINS_NODE_COOKIE=dontKillMe']) {
                    sh '''
                        export BUILD_ID=dontKillMe
                        echo "关闭tomcat,此步非必须,可使用war进行热部署"
                        ssh  -p ${remotePort} administrator@${remoteIp} "cd ${tomcatPath}/bin && ${tomcatPathDisk} && dubbokill"
                        echo "开始使用scp传输文件"
                        warfile1=$(ls 项目名称/target/*.war)
                        scp -P ${remotePort} "${warfile1}"  ${remoteName}@${remoteIp}:${tomcatPath}/webapps
                        warfile2=$(ls 项目名称/target/*.war)
                        scp -P ${remotePort} "${warfile2}"  ${remoteName}@${remoteIp}:${tomcatPath}/webapps
                        echo "开始调用远程tomcat进行重启,此步骤非必须"
                        ssh  -p ${remotePort} administrator@${remoteIp} "cd ${tomcatPath}/bin && ${tomcatPathDisk} && servicestart"
                    '''
                }
            }
        }
    }
}
```
