---
title: 使用arthas排查异常线程
date: 2025-08-02 22:56:39
tag: arthas
---

# 使用arthas排查异常线程

## 背景
使用多线程进行空间计算，初步定位有线程任务未完成导致整体计算任务一直未完成

```java
//一页开启一个线程
        List<Future<List<SpatialTopologyItem>>> resultList = new ArrayList<>();
        for (int i = 0; i < pageCount; i++) {
            List<Integer> ids = allIds.stream().skip(i * oidBatchSize).limit(oidBatchSize).collect(Collectors.toList());
            //分批开始计算
            Future<List<SpatialTopologyItem>> future = executorService.submit(new CalTask(base, comparison, "false", ids));
            resultList.add(future);

        }
        for (Future<List<SpatialTopologyItem>> future : resultList) {
            try {
                //spatialTopologyItems.addAll(future.get());
                List<SpatialTopologyItem> spatialTopologyItems = future.get();
                //入临时库
                geometryIntersectMRProcessor.handResult(spatialTopologyItems, taskInstanceId, stage, jsonObject);
                //主动清理内存
                spatialTopologyItems.clear();
            } catch (InterruptedException | ExecutionException e) {
                e.printStackTrace();
                //线程被中断后异常需要往上抛
                throw new RuntimeException(e);
            }
        }
```

## 分析

使用thread命令查看进程，看到此进程一直未完成

![image-20241212235304964](https://haigeek.me:8443/pic?ossId=2025/08/03/image-20241212235304964.png)

查看进程堆栈信息

```
thread 337
```

![Pasted image 20241212235333](https://haigeek.me:8443/pic?ossId=2025%2F08%2F03%2FPasted+image+20241212235333.png)

![Pasted image 20241213001935](https://haigeek.me:8443/pic?ossId=2025%2F08%2F03%2Fpic%3FossId%3D2025%252F08%252F03%252FPasted%2Bimage%2B20241213001935.png)

根据堆栈提示信息，进一步定位到相关代码，进而定位到时wkt转geometry发生异常（部分复杂图斑在进行 geometry 转换时会发生异常或者非常缓慢，从而导致ther线程会阻塞，导致线程无法结束）

![Pasted image 20241213001959](https://haigeek.me:8443/pic?ossId=2025%2F08%2F03%2FPasted+image+20241213001959.png)

