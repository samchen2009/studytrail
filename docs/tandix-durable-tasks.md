# Tandix 持久任务对接状态

已对接 [Tandix 上游提交 2c43eb9](https://github.com/samchen2009/tandix/blob/2c43eb9a227e1d04efef5af86ef496180281468c/docs/web-api.md)。本文替代先前“待上游实现”的设计草案。

| 能力 | 当前行为 |
| --- | --- |
| 稳定任务 ID | 本地先保存 taskId，再使用官方 run({taskId})，同 ID 的幂等性由 Tandix 校验 |
| 断开 / 刷新后恢复 | attach 原任务；SDK getTask 轮询、退避恢复，查询不执行模型 |
| 进度补取 | 保存事件游标；按 seq 去重；分页及截断 reset 使用上游 text 快照 |
| 最终结果补取 | completed 快照 / task.result 返回原结果，业务先落盘后校验 |
| 原会话继续 | interrupted + resumable:true 时显示用户点击入口；先查询，再以原会话 resume |
| 继续请求幂等 | 本地保存 requestId + prompt，回执丢失时复用；确认下一 attempt 后才允许新的继续操作 |
| 任务关联 | 本地保存 backend、agentId、sessionId、turnId、attempt；Agent / session 改变时停止 |
| 关闭页面 | SDK close 只脱离观察；“取消批改”明确取消原任务 |
| 完全断网期间持续计算 | 不保证：控制器仍在本机，本次没有部署远端任务执行器 |
| 升级前临时任务迁移 | 不支持；没有上游持久映射，不自动重建或重新批改 |

扩展公开 Web API 仍为 v1，通过 hello.taskRecovery=1 区分可恢复协议；伴随程序需 webTaskApiVersion=2。只更新网页或只更新扩展均不够。

自动化验证使用真实上游 SDK 和模拟 Chrome Port，覆盖断线、丢失提交回执、终态补取、分页 / 截断回放、显式同会话续接、丢失续接回执、身份检查和写盘失败不调用模型。本地 API 验证覆盖并发、游标单调、恢复操作 ID 跨重启保留以及评分版本隔离。浏览器使用隔离虚构数据及模拟传输验证刷新自动 attach、继续按钮和 PDF 交付。这些验证不代替安装并登录真实 Tandix 的手写试卷端到端验收。
