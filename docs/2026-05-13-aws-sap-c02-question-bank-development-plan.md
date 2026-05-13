# AWS SAP-C02 题库复习页面开发计划

创建时间：2026-05-13 11:02 JST

关联方案文档：`docs/aws-sap-c02-question-bank-dashboard.md`

## 1. 目标

在现有 dashboard 项目中新增一个 **SAP-C02 个人题库复习页面**，用于替代过去“PDF 放到 iPad/手机上标注”的复习方式。

第一阶段目标：

- 可以导入/录入 SAP-C02 题目；
- 可以浏览题目列表和题目详情；
- 可以标记重点、错题、不确定、已掌握；
- 可以保存个人备注和外部 AI 解释；
- 可以基于现有账号权限体系控制菜单可见性和接口访问；
- 暂不要求移动端专项适配；
- 暂不要求 dashboard 内集成 AI。

## 2. 用户补充点检查结论

用户在方案文档第 15 点补充：

1. **不单独建立 `/admin/` 路由**  
   遵循当前系统设计，新增普通菜单页面，菜单权限 ID 建议：`menu:cert-study`。之后管理员会在“账号管理”里配置权限。

2. **移动端暂时不考虑**  
   原文档 13.3 提到移动端体验风险，当前实施阶段暂不处理移动端专项优化。

检查结论：这两个补充合理，且与现有 dashboard 结构一致。

现有前端 `App.tsx` 已采用：

- 菜单项绑定 `permission: 'menu:xxx'`；
- 页面路由使用 `ProtectedRoute required={['menu:xxx']}`；
- 菜单可见性由当前用户 permissions 控制；
- 非授权访问跳转 `/403`。

因此本功能应按现有模式接入，而不是引入新的 `/admin/*` 权限体系。

## 3. 当前项目结构观察

项目路径：

```text
/Users/liuzelin/github/dashboard
```

主要目录：

```text
eks-dashboard-backend/
eks-dashboard-frontend/
docs/
```

### 3.1 前端

关键文件：

```text
eks-dashboard-frontend/src/App.tsx
eks-dashboard-frontend/src/pages/
```

现有模式：

- 菜单配置集中在 `App.tsx` 的 `menuItems`；
- 页面组件放在 `src/pages/`；
- 路由同样集中在 `App.tsx`；
- 权限 key 形如 `menu:s3-upload`、`menu:ai-ops`、`menu:signal-monitor`；
- 授权失败跳转 `/403`。

### 3.2 后端

关键文件：

```text
eks-dashboard-backend/src/app.module.ts
eks-dashboard-backend/src/access-control/access-control.service.ts
eks-dashboard-backend/src/access-control/platform-database.service.ts
```

现有模式：

- NestJS 模块化结构；
- 平台 DB 通过 `PlatformDatabaseService` 访问，使用 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_DATABASE`；
- 权限默认列表在 `AccessControlService.DEFAULT_PERMISSIONS` 中维护；
- `listPermissions()` 会自动补齐缺失默认权限；
- 账号管理页面基于 permissions 表进行角色授权。

本功能应新增独立后端模块，例如：

```text
eks-dashboard-backend/src/cert-study/
```

并在 `AppModule` 中引入。

## 4. 范围定义

### 4.1 V1 必须实现

#### 后端

- 新增 `cert-study` 模块；
- 新增 MySQL 表；
- 新增权限 key：`menu:cert-study`；
- 新增题目 CRUD 基础接口；
- 新增选项管理；
- 新增复习状态更新接口；
- 新增备注/AI解释增删改查接口；
- 新增手动/JSON 导入接口；
- 所有接口要求当前用户具备 `menu:cert-study` 权限。

#### 前端

- 新增一级菜单：`证书题库`，不放内容；
- 新增二级子菜单：`SAP-C02`；
- 权限 key：`menu:cert-study`；
- 新增路由：建议 `/cert-study/sap-c02`；
- 新增页面：`CertStudyPage.tsx`；
- 题目列表；
- 题目详情抽屉或详情页；
- 标记重点、错题、不确定、已掌握；
- 添加/编辑/删除备注；
- 添加/编辑/删除 AI 解释；
- 手动/JSON 导入入口；
- 基础筛选：状态、重点、来源、标签、关键词。

### 4.2 V1 不做

- 不做 `/admin/*` 专属路由；
- 不做移动端专项适配；
- 不做 dashboard 内 AI 调用；
- 不做 ExamTopics 全站批量爬取；
- 不绕过验证码、登录、付费墙；
- 不做题库公开分享；
- 不做复杂间隔重复算法。

### 4.3 V1.5 / V2 可选

- ExamTopics 单页 URL 导入；
- 导入 preview；
- 导入去重报告；
- 今日待复习；
- 二刷/三刷模式；
- 题目自动标签建议。

## 5. 权限设计

### 5.1 权限 key

新增：

```text
menu:cert-study
```

显示名称建议：

```text
证书题库
```

或：

```text
SAP-C02 题库
```

建议先用更通用的 `证书题库`，方便未来扩展 SAA-C03、DOP-C02、CKA 等。

### 5.2 接入方式

后端：

- 在 `AccessControlService` 的 `DEFAULT_PERMISSIONS` 里新增：

```ts
{ key: 'menu:cert-study', name: '证书题库' }
```

前端：

- 在 `App.tsx` 的 `menuItems` 中新增：

```ts
一级菜单 `证书题库`，二级子菜单 `{ key: '/cert-study/sap-c02', label: 'SAP-C02', permission: 'menu:cert-study' }`
```

- 在 routes 中新增：

```tsx
<Route
  path="/cert-study/sap-c02"
  element={
    <ProtectedRoute required={['menu:cert-study']}>
      <CertStudyPage />
    </ProtectedRoute>
  }
/>
```

接口：

- 需要复用当前认证上下文，确保没有权限时返回 403。
- 如果现有项目没有通用 permission guard，需要在 cert-study controller/service 层显式校验当前用户 permissions，或先抽通用 guard。

## 6. 数据库设计

### 6.1 表清单

V1 建议新增 6 张表：

1. `cert_exams`
2. `cert_questions`
3. `cert_question_options`
4. `cert_question_reviews`
5. `cert_question_notes`
6. `cert_question_tags`

### 6.2 建议 SQL

> 注意：正式实现前需检查项目是否已有 migrations 机制。如果已有，按既有迁移体系落地；如果没有，可新增 SQL 脚本到项目 scripts 或 docs 中，并由后端启动时不自动建表，避免生产误操作。

```sql
CREATE TABLE IF NOT EXISTS cert_exams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cert_questions (
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

CREATE TABLE IF NOT EXISTS cert_question_options (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  option_key VARCHAR(8) NOT NULL,
  option_text MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_question_options (question_id, option_key),
  CONSTRAINT fk_cert_question_options_question FOREIGN KEY (question_id) REFERENCES cert_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cert_question_reviews (
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
  CONSTRAINT fk_cert_question_reviews_question FOREIGN KEY (question_id) REFERENCES cert_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cert_question_notes (
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
  CONSTRAINT fk_cert_question_notes_question FOREIGN KEY (question_id) REFERENCES cert_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cert_question_tags (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  tag VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cert_question_tags (question_id, tag),
  KEY idx_cert_question_tags_tag (tag),
  CONSTRAINT fk_cert_question_tags_question FOREIGN KEY (question_id) REFERENCES cert_questions(id) ON DELETE CASCADE
);
```

### 6.3 初始数据

初始化一条考试记录：

```sql
INSERT INTO cert_exams (code, name, provider)
VALUES ('SAP-C02', 'AWS Certified Solutions Architect - Professional', 'aws')
ON DUPLICATE KEY UPDATE name = VALUES(name), provider = VALUES(provider);
```

## 7. 后端开发计划

### 7.1 目录结构建议

```text
eks-dashboard-backend/src/cert-study/
  cert-study.module.ts
  cert-study.controller.ts
  cert-study.service.ts
  dto/
    create-question.dto.ts
    update-question.dto.ts
    list-questions.dto.ts
    update-review.dto.ts
    create-note.dto.ts
    update-note.dto.ts
    import-questions.dto.ts
  parsers/
    manual-import.parser.ts
    examtopics.parser.ts        # V2
```

### 7.2 API 设计建议

#### 考试

```http
GET /cert-study/exams
POST /cert-study/exams
```

V1 可只内置 SAP-C02，不一定开放创建入口。

#### 题目列表

```http
GET /cert-study/questions?examCode=SAP-C02&keyword=&status=&important=&source=&tag=&page=1&pageSize=20
```

返回：

- questions；
- pagination；
- status summary；
- available tags。

#### 题目详情

```http
GET /cert-study/questions/:id
```

返回：

- question；
- options；
- review；
- tags；
- notes。

#### 创建/更新题目

```http
POST /cert-study/questions
PATCH /cert-study/questions/:id
DELETE /cert-study/questions/:id
```

删除建议 V1 可不做或软删除，避免误删。

#### 更新复习状态

```http
PATCH /cert-study/questions/:id/review
```

body 示例：

```json
{
  "status": "uncertain",
  "isImportant": true,
  "myFinalAnswer": "A",
  "confidence": "medium",
  "lastResult": "wrong",
  "nextReviewAt": "2026-05-14T00:00:00Z"
}
```

#### 备注

```http
POST /cert-study/questions/:id/notes
PATCH /cert-study/notes/:noteId
DELETE /cert-study/notes/:noteId
```

note_type：

- `personal_note`
- `ai_explanation`
- `aws_doc`
- `wrong_reason`
- `option_analysis`
- `discussion`

#### 导入

```http
POST /cert-study/import/manual
POST /cert-study/import/json
```

V2：

```http
POST /cert-study/import/examtopics/preview
POST /cert-study/import/examtopics/confirm
```

### 7.3 业务规则

- 创建题目时根据 `exam_id + stem + options` 生成 `content_hash` 去重；
- 题目答案字段 `source_answer` 只代表来源答案；
- 用户最终判断写入 `cert_question_reviews.my_final_answer`；
- 备注支持 Markdown 文本；
- 题目详情默认不自动展示答案，可由前端控制“显示答案”；
- `review_count/wrong_count/correct_streak` 根据用户提交结果更新；
- V1 不做复杂复习算法，仅允许用户手动设置状态和下次复习时间。

### 7.4 权限校验

必须同时做：

- 前端菜单隐藏；
- 前端 route ProtectedRoute；
- 后端 API 权限校验。

如果后端已有通用 auth/permission middleware，复用；否则开发时先补一个最小 guard 或在 controller 中复用 AuthService 获取当前用户权限。

## 8. 前端开发计划

### 8.1 文件结构建议

```text
eks-dashboard-frontend/src/pages/CertStudyPage.tsx
eks-dashboard-frontend/src/components/cert-study/
  QuestionList.tsx
  QuestionDetailDrawer.tsx
  QuestionImportModal.tsx
  QuestionReviewControls.tsx
  QuestionNotesPanel.tsx
  QuestionOptionList.tsx
eks-dashboard-frontend/src/api/certStudy.ts
```

如果当前项目没有统一 api 目录，则按现有页面习惯实现。

### 8.2 页面布局

V1 建议做单页多区域，不拆复杂路由：

```text
/cert-study
  ├─ 顶部统计卡片
  ├─ 筛选栏
  ├─ 题目表格
  ├─ 导入按钮
  └─ 题目详情 Drawer
```

### 8.3 题目列表字段

- 题号 / source_question_no；
- 题干摘要；
- 来源；
- Domain；
- Tags；
- 状态；
- 重点；
- 复习次数；
- 错误次数；
- 最后复习；
- 操作。

### 8.4 题目详情 Drawer

展示：

- 题干全文；
- 选项；
- 来源答案，默认隐藏，可点按钮显示；
- 我的最终答案；
- 状态控制；
- 重点开关；
- 标签；
- 备注列表；
- 新增备注表单。

### 8.5 导入 Modal

V1 支持：

- JSON 文本导入；
- 手动单题导入。

JSON 格式建议：

```json
[
  {
    "examCode": "SAP-C02",
    "source": "manual",
    "sourceQuestionNo": "1",
    "sourceTopic": "Topic 1",
    "domain": "Design Solutions for Organizational Complexity",
    "stem": "Question text...",
    "options": {
      "A": "Option A",
      "B": "Option B",
      "C": "Option C",
      "D": "Option D"
    },
    "sourceAnswer": "A",
    "tags": ["Route 53", "VPC"]
  }
]
```

## 9. ExamTopics 导入计划（V2）

### 9.1 实现原则

- 用户手动触发；
- 单页 URL；
- 低频；
- 不绕过验证码/登录/付费墙；
- 解析失败允许 fallback 到手动导入；
- 导入前必须 preview；
- 保存 source_url；
- 不公开分发抓取结果。

### 9.2 Parser 目标字段

- `source_question_no`
- `source_topic`
- `stem`
- `options`
- `source_answer`
- `discussion_url`
- `raw_html`

`discussion_url` V1 表结构未单列，可先作为 note 或后续给 `cert_questions` 加字段。

### 9.3 风险

- 页面结构变化；
- Cloudflare/验证码；
- 答案错误；
- 版权/ToS 风险。

缓解：

- V2 才做；
- 保持低频用户触发；
- 允许手动导入；
- 不绕过限制；
- source_answer 与 my_final_answer 分离。

## 10. 验收标准

### 10.1 权限验收

- 未登录访问 `/cert-study`：跳转登录；
- 已登录但无 `menu:cert-study`：跳转 `/403`；
- 有 `menu:cert-study`：可见菜单并可访问页面；
- 无权限用户直接请求后端 API：返回 403。

### 10.2 题目管理验收

- 可创建一条 SAP-C02 题目；
- 可展示题干和选项；
- 可隐藏/显示来源答案；
- 可更新题目状态；
- 可标记重点；
- 可添加个人备注；
- 可添加 AI 解释；
- 可按重点/状态/关键词筛选。

### 10.3 导入验收

- 可通过 JSON 导入多题；
- 重复导入不会产生重复题；
- 导入结果显示成功/重复/失败数量；
- 失败项有错误原因。

### 10.4 数据验收

- `cert_exams` 存在 `SAP-C02`；
- 题目写入 `cert_questions`；
- 选项写入 `cert_question_options`；
- 复习状态写入 `cert_question_reviews`；
- 备注写入 `cert_question_notes`；
- 标签写入 `cert_question_tags`。

## 11. 实施顺序建议

### Step 1：确认数据库表

- 用户已手动创建相关表；
- 实现前检查表结构是否满足代码需要；
- 如缺字段或索引，先停下来确认再调整；
- 初始化/确保 `SAP-C02` exam 记录。

### Step 2：后端 cert-study 基础模块

- 新建模块、controller、service、DTO；
- 接入 `PlatformDatabaseService`；
- 实现 list/detail/create/import/review/note 基础接口；
- 增加 `menu:cert-study` 默认权限。

### Step 3：前端页面骨架

- 新增 `CertStudyPage.tsx`；
- 接入菜单和路由；
- 先展示空状态和权限控制；
- 接 API 加载列表。

### Step 4：题目列表和详情

- 表格；
- 筛选；
- 详情 Drawer；
- 答案显示/隐藏；
- 状态和重点更新。

### Step 5：备注和 AI 解释

- notes panel；
- 新增/编辑/删除 note；
- Markdown 文本展示。

### Step 6：JSON/手动导入

- 导入 modal；
- 后端导入接口；
- 去重；
- 导入结果展示。

### Step 7：测试与修正

- 权限测试；
- API 测试；
- 前端交互测试；
- 用 2-3 条样例题验证完整流程。

## 12. 开发前待确认项

开始编码前建议确认：

1. 当前项目是否已有 DB migration 规范？
2. 后端当前认证信息如何传递到 controller？是否已有 permission guard？
3. `users.id` 是否就是 `cert_question_reviews.user_id` 应引用的用户 ID？
4. 菜单名称最终使用 `证书题库` 还是 `SAP-C02 题库`？
5. 已确认：V1 只做归档，不做硬删除。
6. 已确认：备注支持 Markdown。

## 13. 推荐默认决策

如果没有额外要求，建议默认：

- 菜单名：一级菜单 `证书题库`，二级子菜单 `SAP-C02`；
- 路由：`/cert-study/sap-c02`；
- 权限：一级/二级页面均使用 `menu:cert-study`；
- DB：使用平台 DB，即 `PlatformDatabaseService`，相关表已由用户手动创建；
- `cert_question_reviews.user_id` 关联当前 `users.id`；
- V1 不硬删除题目，只做归档；
- 备注支持 Markdown；
- 先做 JSON/手动导入，不先做 ExamTopics URL 导入；
- 等基础流程跑通后，再评估 ExamTopics 单页 parser。

## 14. 风险控制

- 不自动执行生产 DB 建表，除非明确确认；
- 不抓取 ExamTopics 全站；
- 不提交任何实际题库内容到代码仓库；
- 不把 AI 解释当标准答案，只作为 note；
- source answer 和 user final answer 分离；
- 所有后端写接口必须做权限校验。

## 15. 下一步

建议下一步进入实现前代码勘察：

1. 确认 backend 是否已有 migration/SQL 初始化脚本；
2. 确认 auth/permission guard 实现方式；
3. 确认前端 API 调用封装方式；
4. 以 V1 范围开工实现。
