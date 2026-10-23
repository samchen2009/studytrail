# Tandix Web API 试卷批改接入

本项目直接调用 [Tandix 网页调用接口 v1](https://github.com/samchen2009/tandix/blob/2c43eb9a227e1d04efef5af86ef496180281468c/docs/web-api.md)。SDK 来自上游提交 2c43eb9a227e1d04efef5af86ef496180281468c，保留 MIT 许可证，随网站本地提供；来源与转换方式见 web/vendor/tandix/UPSTREAM.md。

流程为：TandixClient.discover() → hello() → 用户点击开始后 authorize()（仅首次需要）→ run({prompt, files, responseFormat:'json'}) → onProgress() → result().data → 本地业务校验 → 保存与渲染。正常任务无需打开侧栏。API v1 只支持已登录的 Codex，扩展和本机伴随程序均须更新。

自动发现不发送资料或启动任务。授权被拒绝时不读取或传输文件。只从当前任务的本地资产中构建 File，通过 SDK 分块上传；不枚举扩展、不读取登录凭据、不传 DOM/Cookie。模型收到完整附件到页 ID 的映射，返回标记位置引用现有阅读页。网页任务没有 Tandix 浏览器/技能工具，因此提示词只要求处理附件并返回 JSON。

阅读图片模式发送已本机渲染的每页 JPEG，原文件模式发送原始 PDF / 图片。根据 hello() 返回的限制检查文件数量、类型与大小；超限不会静默截断或自动分批。进度文本不作为最终答案；只消费 result().data，按共享业务契约二次校验后保存。完整 AI 批改使用 replace 模式，避免新旧题目混合计分；人工恢复提交沿用对应模式。

## 原任务恢复和原会话继续

使用上游提交 2c43eb9 的可恢复任务接口。公开 Web API 仍为 v1，`hello.taskRecovery === 1` 是必需能力标志，配套本机伴随程序使用内部协议 v2。旧扩展缺少能力时提交前报错，不退回不可恢复的临时任务，也不重跑整卷。

提交前由本地服务器生成并原子保存稳定 `taskId`，网页再调用官方 `run({taskId, prompt, files, responseFormat:'json'})`。不再修改上游 SDK，也不再需要 beforeSubmit 扩展。SDK 在提交确认丢失时查询原 taskId，不重发 tasks.run。

执行记录位于 `.data/grading/<试卷 UUID>/ai-run/`，不纳入 Git，和评分版本独立：保存原试卷版本、发送模式、完整提示、任务 ID、进度与游标、原 Agent / session / turn 标识、attempt、可续接状态、继续操作的幂等 ID 和最终 JSON。进度约每两秒落盘，游标和展示文本在同一个原子版本中保存。事件重收去重；上游事件截断时以完整 text 快照替换展示，分页回放不重复追加已有文字。

重新打开批改页会恢复上次选择的试卷；未完成的新协议任务自动 `attach(taskId,{afterSeq:cursor})`，只补取原任务进度和结果，不读取或重传附件、不调用 run。SDK 负责传输断线后 2–10 秒退避查询。未授权时自动恢复只提示，用户点击“连接原任务”后才允许打开授权页。查询不明、unknown-task、原 Agent 身份改变或 session-unavailable 不会触发新建任务。

执行超时及需要补充信息时，上游保留原会话并进入 interrupted。仅当快照确认 `resumable: true`，页面提供“继续原任务”和补充要求；此操作由用户明确点击，不自动调用模型。先将继续操作 requestId 与完整继续 prompt 保存到本机，再查询原任务；已完成则补取结果，仍运行则继续观察，明确中断才调用 task.resume。继续请求确认丢失时复用原 requestId + prompt；确认进入下一 attempt 后，后续中断才生成新的继续 ID。原 taskId、Agent、sessionId、附件和工作目录均不变。原会话身份改变时停止恢复。

已收到的最终 JSON 在业务校验和评分保存前先落盘；刷新后可从本机恢复。评分仍按原输入版本提交，其他标签页修改评分导致版本冲突时不会自动覆盖，而保留 JSON 供人工核对。PDF 失败仅重新生成。多个标签页可以观察同一任务，服务器阻止重复创建并避免旧游标覆盖新记录。

关闭页面 / SDK close 只停止观察，不自动取消任务；“取消批改”才明确取消原任务。升级前已发出的临时任务缺少 Tandix 持久映射，不会凭旧 ID 自动迁移。

**能力边界：任务仍由本机伴随程序执行。完全断网时不能保证云端模型继续计算，也不能保证恢复同一个 token 的内部计算位置。** 新接口支持任务 / 会话持久化、结果补取和确认状态下的原会话继续；浏览器退出、伴随程序重启、配置切换或历史删除仍可能中断或需要人工处理。详见 [上游接口与恢复边界](tandix-durable-tasks.md)。

协议回归测试使用上游真实 SDK 和模拟 Chrome Port，验证自动发现、hello、分块文件上传、最终 JSON、拒绝授权、限制、进度与取消。它不能代替安装并登录真实 Tandix 的 Chrome / Edge 验收，更不能证明手写识别和模型评分准确率。开发不上传真实学生资料。

## 结果契约

运行时的完整示例可在批改页面“批改结果格式与评分约定”查看。格式为 `studytrail.grading-result/v1`：

- `reviewedPageIds`：本批实际读取的非参考答案页面 ID。
- `questions`：独立题目标识 `id`、显示题号 `number`、完整 `stem`、如实转写的 `studentAnswer`、正确 `answer`。
- `maxScore` / `score`：明确的满分与得分；原卷无完整逐题分值时，全卷按每道编号题 10 分估算（小问在该题内分配）。`scoreBasis: estimated` 标明参考分，`scoringNote` 写出分配依据，展示如 8/10 及整卷折合成绩。原卷分值完整时 `scoreBasis: paper`。仅字迹、题干或答案无法判断时保留待核；缺少印刷分值本身不再阻止参考评分。旧结果的空得分不会推测为正确或错误，显示范围并提示重新批改补评分。
- `confidence` / `needsReview` / `reviewReason`：识别置信度、是否待核及依据。
- `regions`：页 ID、`anchorText` 定位依据和原图宽高归一化的 `x/y` 标记锚点；不是浏览器屏幕坐标。跨页题可有多个位置。
- `rubric`：评分点、满分、得分，以及 `evidence`（实际作答片段）和 `reason`（给扣分理由）；两项合计必须与题目一致。旧结果的证据字段可为空，新批改提示要求提供。
- `methods`：方法名称和有序教学步骤，最多六种。不存在合适替代方法时不强行凑数。
- `knowledgePoints`：该题涉及的知识点。
- `diagrams`：图名、说明和图形元素列表，画布 600×600；允许 line、polyline、circle、rect、text，禁止任意 HTML、SVG 源码和脚本。
- `knowledgeSummary` / `overallFeedback`：知识点定义、适用条件、易错点、练习建议和整卷建议。

手工分批结果按题目标识合并；完整 API 批改替换原结果和人工复核。同一题跨页须合并，不能重复计分。已阅页集合取并集；知识总结按主题更新。相同题目标识的新 AI 结果会清除该题人工复核，以免旧复核错误地套到新作答上。

## 本地 API

所有写接口拒绝跨来源请求；仅在默认回环地址的本地模式提供。文件名只作元数据，磁盘路径使用服务端 UUID。

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/grading/jobs` | 任务摘要 |
| `POST /api/grading/jobs` | 创建本地任务 |
| `GET /api/grading/jobs/:id` | 读取版本和完整任务 |
| `DELETE /api/grading/jobs/:id` | 移入已删除试卷，JSON 携带 baseRevision |
| `POST /api/grading/jobs/:id/restore` | 恢复已删除试卷，JSON 携带 baseRevision |
| `POST /api/grading/jobs/:id/assets` | 原文件或阅读页二进制上传，带 `X-Base-Revision` |
| `POST /api/grading/jobs/:id/complete` | 验证某原文件阅读页数量及连续页码，标记转换完整 |
| `GET /api/grading/jobs/:id/files/:assetId` | 读取文件；`?download=1` 下载 |
| `POST /api/grading/jobs/:id/result` | 校验、合并批改结果 |
| `POST /api/grading/jobs/:id/review` | 保存人工得分复核及依据 |
| `POST /api/grading/jobs/:id/positions` | 携带 baseRevision、questionId、regionIndex 以及 position{pageId,x,y} 保存位置；reset:true 恢复 AI 位置 |
| `GET /api/grading/jobs/:id/ai-run` | 读取原 AI 执行记录与已收到的最终结果 |
| `POST /api/grading/jobs/:id/ai-run` | 原子创建 / 更新本地执行记录，独立修订号；禁止不确定状态下重复提交 |
| `GET /api/grading/jobs/:id/exports` | 当前评分版本的评分PDF、HTML和原有解答PDF生成状态 |
| `POST /api/grading/jobs/:id/exports/:kind` | 保存 marked / answers PDF，带 X-Base-Revision，最大 64 MiB |
| `GET /api/grading/jobs/:id/exports/:kind` | 下载当前版本的批改卷或详细解答 PDF |
| `POST /api/grading/jobs/:id/exports/answers-html` | JSON携带baseRevision，从服务端已保存材料生成离线解答；不接收模型HTML |
| `GET /api/grading/jobs/:id/exports/answers-html` | 打开当前版本的HTML解答；`?download=1`下载；`?print=1`打开打印 |

JSON 写操作携带 `baseRevision`，旧版本提交返回 409。每次写入在 `.data/grading/<任务 UUID>/` 新建不可覆盖的版本 JSON，原文件和阅读页保存在其 `assets/` 中。失败的并发文件写入会清理未引用的资产，不覆盖已保存记录。

删除是可恢复的：在新版本中记录 `deletedAt`，普通列表不显示，任务列表接口另返回 `deletedJobs`。已删除试卷不能读取文件、下载 PDF 或继续写入结果；恢复后原卷、评分、人工复核与 PDF 均可继续使用。删除和恢复只改变生命周期状态，`scoreRevision` 保持不变，因此不会使已有 PDF 失效；评分或内容更新后才切换 PDF 版本。没有物理清空功能。

服务器不接受模型提供的总分，改由共享校验模块逐题合计。原始 JSON / 图形文本在页面和导出报告中均转义。浏览器接口测试、评分规则测试及虚构 PDF 的实际浏览器验证，不代表已验证某个真实模型的手写识别或批改准确率。

## HTML 批改与解答，按需 PDF

默认成果为 HTML 批改卷和详细解答，JSON作为内部结构与高级恢复入口。结果保存与人工复核后分别生成两项成果；一项失败不阻塞另一项，点击“生成成果 / 重试失败项”只补生成缺少的文件，不重跑模型。旧任务也可直接生成HTML。

- 批改卷：成绩总览和逐题成绩在前，后附所有非参考答案的原卷阅读页，页边标注绿勾、红叉、部分得分三角、待核问号和逐题分数，并用引线连接卷面锚点。保持原图比例，横卷使用横向页面。
- 详细解答HTML：收录全部题干/选项、学生作答、参考答案、评语、评分依据、多种适用解法、结构化SVG示意图、知识点和原卷；支持题号导航、折叠、搜索和复制。KaTeX在本机预渲染LaTeX数学公式，mhchem处理化学式，原图、CSS和所需WOFF2字体内嵌单文件，不依赖CDN。普通内容转义，公式关闭信任能力；非法公式保留原文并显示“公式待核”，不会静默丢弃。

批改和解答均通过 HTML 的“打印 / 另存 PDF”按需导出；打印前等待图片与字体并展开内容。旧 PDF 的读写接口保留，日常生成仅调用 `marked-html` 与 `answers-html`。

- `GET /api/grading/jobs/:id/reports/marked|answers`：在线 HTML，按当前快照生成，支持逐题收录；使用同源独立题图 URL。
- `POST /api/grading/jobs/:id/exports/marked-html|answers-html`：生成离线自包含 HTML；`GET` 下载既有文件。
- `GET /api/grading/jobs/:id/questions`：当前评分版本的逐题图像清单。
- `GET /api/grading/jobs/:id/question-assets/:hash.jpg`：独立 JPEG（保留原页坐标与方向映射）。
- `POST /api/mistakes/collect` 接收 `scoreRevision`；与当前评分不一致时返回 409，重复收录复用题目。

题图位于 `.data/grading/<UUID>/question-assets/<SHA256>.jpg`；逐题映射位于 `questions/<评分版本>-v1.json`；离线报告位于 `exports/<评分版本>-reports-html-v2-marked.html` 或 `-answers.html`。纯文字题复用完整题干，不强制将文字栅格化。现有分数/复核规则不因改用 HTML 改变。

在线报告采用同源 CSP、转义文字及带 nonce 的固定脚本，仅通过本地接口收录；离线版禁止网络访问并保留 sandbox 响应策略。图片与 HTML 都可从已保存题目重新生成，不重新调用模型。
