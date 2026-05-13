# AWS SAP-C02 题库复习 Dashboard 方案讨论

创建时间：2026-05-13 10:40 JST

## 1. 背景与目标

用户计划备考 `AWS Certified Solutions Architect - Professional (SAP-C02)`。

之前备考其他证书时，主要方式是：

- 下载 PDF 题库；
- 放到 iPad / 手机上阅读；
- 对重点题、易错题、需要反复理解的题进行标注；
- 二刷、三刷时重点回看标注内容。

本次希望在本地 dashboard 项目中新增一页，用于管理 SAP-C02 题库复习流程：

- 浏览题目；
- 标记重点题；
- 标记错题 / 不确定题 / 已掌握；
- 记录个人备注；
- 记录 AI 解释内容；
- 支持后续二刷、三刷；
- 当前阶段不要求在 dashboard 内直接集成 AI 功能。

## 2. 已确认约束

- 项目路径：`/Users/liuzelin/github/dashboard`
- 当前项目已有 MySQL，作为题库和复习记录 DB。
- 仅个人使用。
- 权限策略：只允许 `admin` 访问；非授权角色访问返回 `403`。
- 第一阶段可接受手动/半自动导入。
- 主要导入源预计为 ExamTopics。
- 如果 ExamTopics 不支持稳定 URL 抓取导入，不强求自动导入。

## 3. 核心结论

### 3.1 Dashboard 能否直接展示 SAP-C02 所有题目？

技术上可以，但前提是 dashboard 的数据库里已经有题目数据。

也就是说，dashboard 本身不是题目来源。它需要以下任一方式获得题目：

1. 手动导入题目；
2. 从 ExamTopics 单页/多页解析导入；
3. 从本地 Markdown / JSON / CSV / PDF 导入；
4. 后续通过浏览器复制粘贴、插件、脚本等方式半自动导入。

因此当前理解是：

> 不能凭空在 dashboard 中展示 SAP-C02 全量题库；需要先有一个导入流程，把题目写入 MySQL。

### 3.2 是否必须依靠用户逐题导入？

不一定。

推荐分阶段：

- V1：支持手动粘贴/JSON/Markdown 导入，保证系统先可用。
- V2：支持 ExamTopics 页面 URL 导入，自动解析该页面上的题目。
- V3：如果稳定且合规，再考虑批量导入多个页面。

这样不需要一开始完全依赖用户逐题录入，但也避免把系统强绑定到 ExamTopics 爬虫上。

### 3.3 AI 解释和个人备注能否挂到题目下？

可以，且建议作为核心能力。

当前阶段不需要 dashboard 内集成 AI，只需要支持用户把外部 AI 的解释复制进来即可。

每道题建议支持多条 notes，例如：

- 个人理解；
- AI 解释；
- AWS Docs 链接；
- 错题原因；
- 选项排除逻辑；
- 二刷/三刷补充备注。

## 4. 开源项目和网络调研摘要

使用 Tavily 搜索了以下方向：

- open source exam question bank review dashboard spaced repetition annotations
- GitHub open source exam prep question bank notes wrong answers dashboard
- ExamTopics scraper GitHub examtopics parser question bank

### 4.1 相关类型一：通用题库/考试系统

代表：

- `Samkarya/online-exam-questions`
  - GitHub：https://github.com/Samkarya/online-exam-questions
  - 特点：用 JSON 结构化维护题库，字段包括 question_text、options、correct_answer、subject、topic、difficulty、explanation。
  - 可借鉴点：题库 JSON schema、Markdown/HTML/LaTeX 支持、解释字段。
  - 不足：偏题库数据仓库，不是个人错题/复习 dashboard。

### 4.2 相关类型二：错题本/复习工具

代表：

- `mrmagic2020/Wrong-Question-Notebook`
  - GitHub：https://github.com/mrmagic2020/Wrong-Question-Notebook
  - 特点：Web 错题本，用于记录、组织、复习错题。
  - 可借鉴点：错题状态、复习管理、笔记组织。
  - 不足：不一定适配 SAP-C02 这种长题干、多选项、来源导入场景。

### 4.3 相关类型三：间隔重复/刷题系统

代表：

- Anki / Mnemosyne / OpenCards / SuperMemo 类工具。
- 相关搜索结果显示，间隔重复适合长期记忆管理。

可借鉴点：

- `reviewCount`
- `wrongCount`
- `correctStreak`
- `nextReviewAt`
- 根据答题结果安排下一次复习。

但 SAP-C02 不只是记忆题，更重要的是架构取舍，所以不建议完全做成 Anki 卡片模式，而应保留完整题干、选项、解析、备注和服务对比。

### 4.4 相关类型四：ExamTopics 抓取工具

搜索到一些 ExamTopics scraper / parser：

- `aserpi/examtopics_scraper`
  - GitHub：https://github.com/aserpi/examtopics_scraper
  - 描述：Scraper for question discussions on ExamTopics。
  - 可借鉴点：ExamTopics 页面结构解析、discussion 抓取。

- `thai-nm/dumps-search`
  - GitHub：https://github.com/thai-nm/dumps-search
  - 描述：Python tool to search for ExamTopic dumps，支持部分考试，包括 SAP-C02。
  - 风险点：项目定位包含 dumps/PDF scraper，不建议直接照搬为产品主线。

- `swarnava-dutta/Free-Exam-Dumps`
  - GitHub：https://github.com/swarnava-dutta/Free-Exam-Dumps
  - 描述：scrape ExamTopics to fetch dumps。
  - 风险点：明显 dumps 导向，不建议采用。

结论：

- 开源里确实存在 ExamTopics 抓取工具；
- 可以参考页面解析思路；
- 不建议直接引入 dumps 导向项目作为 dashboard 的核心依赖；
- 更建议实现“用户触发、低频、单页/有限页面导入”的自有导入器。

## 5. 产品定义建议

不要把功能定义为：

> ExamTopics 爬虫

建议定义为：

> 个人考试复习题库模块 / Certification Study Question Bank

ExamTopics 只是一个可选导入源。

这样更安全，也方便后续扩展到：

- AWS SAA-C03；
- AWS DOP-C02；
- Kubernetes CKA/CKAD；
- 其他证书；
- PDF/Markdown/JSON 导入。

## 6. MVP 功能范围

### 6.1 页面入口

新增一个 admin-only 页面，例如：

- `/admin/cert-study`
- `/admin/cert-study/sap-c02`
- 或根据 dashboard 现有路由风格命名。

非 admin 访问：返回 `403`。

### 6.2 题目列表

列表字段建议：

- 题号；
- 来源：ExamTopics / Manual / PDF / Official；
- 来源页面 URL；
- Domain；
- 服务标签；
- 状态：未做 / 做错 / 不确定 / 已掌握；
- 是否重点；
- 复习次数；
- 错误次数；
- 最后复习时间；
- 下次复习时间。

筛选：

- 只看重点；
- 只看错题；
- 只看不确定；
- 只看未掌握；
- 按 Domain；
- 按服务标签；
- 按二刷/三刷；
- 按来源。

### 6.3 题目详情

详情页展示：

- 题干；
- 选项 A/B/C/D/E/F；
- 来源答案；
- 我的最终答案；
- 我的作答历史；
- 我的备注；
- AI 解释；
- AWS Docs 链接；
- 原始来源链接；
- 讨论链接；
- 题目争议标记。

操作：

- 标记重点；
- 标记错题；
- 标记不确定；
- 标记已掌握；
- 添加备注；
- 添加 AI 解释；
- 添加 AWS Docs 链接；
- 更新最终答案；
- 设置下次复习时间。

### 6.4 导入能力

MVP 推荐支持：

1. 手动粘贴题目导入；
2. JSON/Markdown 导入；
3. ExamTopics URL 单页导入（如果解析稳定）。

不建议第一版做：

- 全站批量高速抓取；
- 绕验证码/登录/付费墙；
- 付费内容抓取；
- 将题库公开给非 admin 用户；
- 将抓到的题目提交到公共仓库。

## 7. MySQL 数据模型建议

### 7.1 cert_exams

用于支持未来多证书。

```sql
CREATE TABLE cert_exams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

示例：

- code: `SAP-C02`
- name: `AWS Certified Solutions Architect - Professional`
- provider: `aws`

### 7.2 cert_questions

题目主表。

```sql
CREATE TABLE cert_questions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  exam_id BIGINT NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_url TEXT NULL,
  source_question_no VARCHAR(64) NULL,
  source_topic VARCHAR(128) NULL,
  domain VARCHAR(255) NULL,
  stem MEDIUMTEXT NOT NULL,
  source_answer VARCHAR(64) NULL,
  explanation MEDIUMTEXT NULL,
  raw_html MEDIUMTEXT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_questions_hash (exam_id, content_hash),
  KEY idx_cert_questions_exam (exam_id),
  CONSTRAINT fk_cert_questions_exam FOREIGN KEY (exam_id) REFERENCES cert_exams(id)
);
```

### 7.3 cert_question_options

选项表。

```sql
CREATE TABLE cert_question_options (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  option_key VARCHAR(8) NOT NULL,
  option_text MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_question_options (question_id, option_key),
  CONSTRAINT fk_cert_question_options_question FOREIGN KEY (question_id) REFERENCES cert_questions(id)
);
```

### 7.4 cert_question_reviews

个人复习状态表。

当前只有 admin 使用，但仍建议预留 `user_id`，便于未来扩展。

```sql
CREATE TABLE cert_question_reviews (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  is_important TINYINT(1) NOT NULL DEFAULT 0,
  my_final_answer VARCHAR(64) NULL,
  confidence VARCHAR(32) NULL,
  review_count INT NOT NULL DEFAULT 0,
  wrong_count INT NOT NULL DEFAULT 0,
  correct_streak INT NOT NULL DEFAULT 0,
  last_result VARCHAR(32) NULL,
  last_reviewed_at DATETIME NULL,
  next_review_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_question_reviews_user_question (user_id, question_id),
  KEY idx_cert_question_reviews_status (status),
  KEY idx_cert_question_reviews_next_review (next_review_at),
  CONSTRAINT fk_cert_question_reviews_question FOREIGN KEY (question_id) REFERENCES cert_questions(id)
);
```

status 建议值：

- `new`
- `reviewing`
- `uncertain`
- `mastered`
- `archived`

last_result 建议值：

- `correct`
- `wrong`
- `uncertain`
- `skipped`

### 7.5 cert_question_notes

备注/AI解释/文档链接表。

```sql
CREATE TABLE cert_question_notes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  note_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NULL,
  content MEDIUMTEXT NOT NULL,
  url TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cert_question_notes_question (question_id),
  KEY idx_cert_question_notes_type (note_type),
  CONSTRAINT fk_cert_question_notes_question FOREIGN KEY (question_id) REFERENCES cert_questions(id)
);
```

note_type 建议值：

- `personal_note`：个人备注；
- `ai_explanation`：AI 解释；
- `aws_doc`：AWS 官方文档链接/摘录；
- `wrong_reason`：错题原因；
- `option_analysis`：选项排除逻辑；
- `discussion`：讨论摘要。

### 7.6 cert_question_tags

题目标签表。

```sql
CREATE TABLE cert_question_tags (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  tag VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_question_tags (question_id, tag),
  KEY idx_cert_question_tags_tag (tag),
  CONSTRAINT fk_cert_question_tags_question FOREIGN KEY (question_id) REFERENCES cert_questions(id)
);
```

示例标签：

- `VPC`
- `Transit Gateway`
- `Route 53`
- `Aurora`
- `DMS`
- `Organizations`
- `SCP`
- `DR`
- `Cost Optimization`

## 8. ExamTopics 导入设计

### 8.1 推荐导入边界

允许：

- admin 手动输入 URL；
- 单页解析；
- 低频请求；
- 用户确认后写入 DB；
- 保留 source_url；
- 自动去重；
- 解析失败允许手动修正。

不建议：

- 高速批量爬取；
- 绕过验证码；
- 抓登录/付费内容；
- 公开分发题库；
- 将抓取结果提交到公开仓库；
- 盲信 ExamTopics 的 correct answer。

### 8.2 导入流程

```text
Admin 输入 ExamTopics URL
  ↓
后端 fetch HTML
  ↓
Parser 提取题目/选项/答案/题号/topic/discussion 链接
  ↓
生成 content_hash 去重
  ↓
返回 preview
  ↓
Admin 确认导入
  ↓
写入 cert_questions / cert_question_options
```

### 8.3 题目答案可信度

ExamTopics 上的答案可能有错或存在争议。

建议：

- `source_answer` 只表示来源答案；
- 用户可维护 `my_final_answer`；
- 支持 `confidence`；
- 支持备注中记录争议和 AWS Docs 证据。

## 9. AI 解释与个人备注设计

当前阶段不集成 AI，但支持保存外部 AI 输出。

推荐交互：

- 题目详情页添加 “新增备注”；
- note_type 可选：个人备注 / AI解释 / AWS Docs / 错题原因 / 选项分析；
- 支持 Markdown；
- 支持多条备注按时间倒序或类型分组展示。

典型使用：

1. 用户在 dashboard 中看到不懂的题；
2. 复制题干和选项去问 AI；
3. 将 AI 解释复制回该题的 `AI解释` note；
4. 再补一条自己的 `个人备注` 或 `错题原因`；
5. 标记为 `重点` 或 `不确定`，进入二刷。

## 10. 权限设计

因为只给个人使用，权限可以简单明确：

- 所有 `/cert-study` 相关页面和 API 均要求登录；
- 当前用户必须是 `admin`；
- 非 admin：返回 `403`；
- 不在普通菜单展示入口；
- 后端 API 也必须校验权限，不能只靠前端隐藏。

## 11. 页面建议

### 11.1 题目列表页

功能：

- 搜索题干；
- 按状态筛选；
- 按标签筛选；
- 按 Domain 筛选；
- 只看重点；
- 只看今日待复习；
- 快速标记重点/掌握/不确定。

### 11.2 题目详情页

功能：

- 展示完整题干和选项；
- 显示/隐藏来源答案；
- 记录我的答案；
- 添加备注和 AI 解释；
- 标记状态；
- 设置下次复习；
- 展示复习历史。

### 11.3 导入页

功能：

- 粘贴 ExamTopics URL；
- 粘贴 Markdown/JSON；
- 预览解析结果；
- 确认导入；
- 显示导入成功/跳过去重/失败原因。

### 11.4 复习页

功能：

- 今日待复习；
- 错题复习；
- 重点题复习；
- 随机抽题；
- 二刷/三刷模式。

## 12. 推荐实施阶段

### V1：本地题库 + 标注系统

目标：先可用。

范围：

- MySQL 表；
- admin-only 页面；
- 题目列表；
- 题目详情；
- 手动/JSON/Markdown 导入；
- 重点/错题/不确定/已掌握；
- 个人备注和 AI 解释；
- 基础筛选。

### V2：ExamTopics 单页导入

目标：减少手工导入成本。

范围：

- 输入 ExamTopics URL；
- 单页解析；
- preview；
- 确认导入；
- 去重；
- 保存 source_url。

### V3：复习调度

目标：替代 PDF 标注，提升二刷/三刷效率。

范围：

- `nextReviewAt`；
- `reviewCount`；
- `wrongCount`；
- `correctStreak`；
- 今日待复习；
- 错题原因统计。

### V4：智能增强，可选

目标：降低复盘成本。

范围：

- 自动识别 Domain；
- 自动打服务标签；
- 自动总结题目约束；
- 自动生成选项排除逻辑草稿；
- 自动推荐 AWS Docs。

当前阶段暂不做 dashboard 内 AI 集成。

## 13. 风险与注意事项

### 13.1 合规风险

ExamTopics 可能不允许自动抓取和再展示。

缓解：

- 只做个人 admin 使用；
- 不公开题库；
- 不做高速批量抓取；
- 不绕过验证码/登录/付费墙；
- 保留来源链接；
- 支持手动导入作为 fallback。

### 13.2 答案错误风险

ExamTopics 答案可能错误或争议。

缓解：

- source_answer 和 my_final_answer 分离；
- 支持 confidence；
- 支持 AWS Docs 证据备注；
- 重点看讨论而不是盲信答案。

### 13.3 移动端体验风险

用户原先习惯 iPad/手机复习。

缓解：

- 页面必须移动端友好；
- 题干阅读体验优先；
- 操作按钮大且少；
- 支持快速标记。

## 14. 推荐结论

该需求可行，且适合接入当前 dashboard。

推荐优先做：

1. MySQL 题库与复习标注模型；
2. admin-only 题目列表/详情/备注；
3. 手动或 JSON/Markdown 导入；
4. 再做 ExamTopics 单页 URL 导入；
5. 最后做复习调度和统计。

最重要的产品边界：

> dashboard 是个人复习管理系统，不是公开题库站，也不是 dumps 分发系统。

## 15. 补充

6.1 
不用这样单独建 /admin/ 路由。遵循系统当前设计，新增加一个菜单页面，给菜单ID例如：menu:cert-study， 之后管理员会去”账号管理“ 菜单去做权限配置。

13.3
移动端暂时不考虑