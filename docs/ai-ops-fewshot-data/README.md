# AI Ops 方案3（few-shot）数据采集模板

本目录用于收集 AI-Ops 样本数据（SQL 为当前生效，Mongo 为后续规划）。

- 当前生效：`自然语言 -> SQL` 预览能力优化。
- 后续规划：`自然语言 -> Mongo 查询语句` 能力（当前代码未启用，仅先采集样本）。

## 文件清单

- `nl2sql_fewshot_cases.csv`
  - 目的：收集高频真实问句与期望 SQL（最重要）。
- `table_dictionary.csv`
  - 目的：描述核心表字段的业务含义。
- `join_relations.csv`
  - 目的：描述常用 join 路径与关联键。
- `enum_dictionary.csv`
  - 目的：沉淀状态码/类型码等枚举值含义。
- `nl2mongo_fewshot_cases.csv`（后续规划）
  - 目的：收集高频真实问句与期望 Mongo 查询语句。
- `mongo_collection_dictionary.csv`（后续规划）
  - 目的：描述 Mongo 集合字段路径、类型、业务含义。
- `mongo_relations.csv`（后续规划）
  - 目的：描述集合间引用关系与推荐查询模式。
- `mongo_enum_dictionary.csv`（后续规划）
  - 目的：沉淀 Mongo 枚举值含义。

## 推荐工作流（原始采集 + 清洗导入）

建议把当前目录下的 CSV 作为“原始采集文件”，每次导入前先跑一次清洗脚本，把可导入版本写到 `import/` 目录。

- 清洗命令（仓库根目录执行）：

```bash
node scripts/clean-aiops-fewshot-csv.js
```

- 指定输入/输出目录：

```bash
node scripts/clean-aiops-fewshot-csv.js --in docs/ai-ops-fewshot-data --out docs/ai-ops-fewshot-data/import
```

- 仅清洗 SQL 两张核心表：

```bash
node scripts/clean-aiops-fewshot-csv.js --only nl2sql_fewshot_cases.csv,table_dictionary.csv
```

脚本会同时输出 `docs/ai-ops-fewshot-data/import/clean-report.json`，用于查看缺失字段、可疑 SQL、未带库名前缀等告警。

## 先填什么（建议顺序）

1. 先填 `nl2sql_fewshot_cases.csv`（至少 20 条）。
2. 再填 `table_dictionary.csv`（先覆盖 5-10 张核心表）。
3. 再补 `join_relations.csv` 与 `enum_dictionary.csv`。
4. 如需规划 Mongo，再补 `nl2mongo_fewshot_cases.csv` 等 4 个 Mongo 模板。

## “字段越全面越好”吗？

结论：方向对，但优先级是“高质量 > 大而全”。

- 最有效的是：
  - 高频真实问句；
  - 对应可执行的标准 SQL；
  - 关键字段业务语义与常见 join。
- 不建议一开始就全量导入所有 DDL 与所有字段说明，否则噪声会很大。

## 填写原则

- 使用脱敏数据，不要写真实账号、手机号、邮箱、密钥、IP、内部域名。
- SQL 必须使用 `db.table` 全限定名。
- 默认带 `LIMIT`，并注明业务上合理范围。
- 问句尽量贴近真实运维同学输入，而不是“教科书式描述”。
- 每条样本都建议写上 `review_status`（`draft/reviewed/approved`）。
- CSV 第一行表头请保持当前纯英文键，不要改成中文或“英文+中文注释”。

## 字段填写说明（给不熟悉数据库的同学）

如果你不熟悉数据库，也可以先按下面“必填列”提供业务信息，SQL 和字段细节可由 DBA/研发二次补齐。

### 1) `nl2sql_fewshot_cases.csv`

建议至少填写这些列（必填）：

- `case_id（样例ID）`：唯一编号，例如 `CASE_001`。
- `priority（优先级）`：`P0/P1/P2`，`P0` 代表最常用。
- `user_question（用户问题）`：真实问法，尽量口语化。
- `expected_sql（期望SQL）`：期望 SQL（需 `db.table` + `LIMIT`）。
- `allowed_databases（允许库）`：如 `spot` 或 `spot;tiger`。
- `allowed_tables（允许表）`：如 `spot.users` 或 `spot.*`。
- `review_status（评审状态）`：`draft/reviewed/approved`。

建议填写这些列（选填）：

- `must_conditions（必须条件）`：如 `must_have_limit;must_use_db_table`。
- `forbidden_patterns（禁用模式）`：如 `no_select_star_if_possible`。
- `notes（备注）`：补充业务背景、边界条件。

### 2) `table_dictionary.csv`

建议至少填写这些列（必填）：

- `database_name（库名）`：如 `spot`。
- `table_name（表名）`：如 `users`。
- `column_name（列名称）`：如 `uid`。
- `data_type（数据类型）`：如 `bigint/varchar/datetime`。
- `business_meaning（业务含义）`：这列是做什么的，务必写清楚。

建议填写这些列（选填）：

- `is_primary_key（主键）`、`is_indexed（有索引）`、`is_join_key（关联键）`：填 `YES/NO`。
- `sample_values（示例值）`：填脱敏后的样例值。
- `pii_level（敏感级别）`：`none/low/high`。

### 3) `join_relations.csv`

建议至少填写这些列（必填）：

- `relation_id（关系ID）`：唯一编号，如 `REL_001`。
- `left_database/left_table/left_column`：左侧表与关联列。
- `right_database/right_table/right_column`：右侧表与关联列。
- `join_type（JOIN类型）`：`INNER/LEFT/RIGHT`。
- `typical_query_purpose（典型用途）`：一句话说明为什么要 join。

### 4) `enum_dictionary.csv`

建议至少填写这些列（必填）：

- `enum_id（枚举ID）`：唯一编号，如 `ENUM_001`。
- `database_name/table_name/column_name`：枚举所在列。
- `enum_value（枚举值）`：如 `1`。
- `enum_label（枚举标签）`：如 `active`。
- `business_description（业务说明）`：该值具体表示什么。

## Mongo 模板字段说明（后续规划，当前代码未启用）

重要说明：

- 当前项目代码仍只支持 MySQL SQL 预览，不支持 Mongo 语句生成。
- 以下模板先用于数据采集与方案准备，不会立即进入线上推理链路。

### 5) `nl2mongo_fewshot_cases.csv`

建议至少填写这些列（必填）：

- `case_id（样例ID）`：唯一编号，如 `MONGO_CASE_001`。
- `priority（优先级）`：`P0/P1/P2`。
- `user_question（用户问题）`：真实运维问句。
- `expected_mongo_statement（期望Mongo语句）`：如 `db.users.find(...).limit(...)`。
- `allowed_databases（允许库）`：Mongo database 名称。
- `allowed_collections（允许集合）`：如 `users` 或 `users;orders`。
- `review_status（评审状态）`：`draft/reviewed/approved`。

建议填写这些列（选填）：

- `must_conditions（必须条件）`：如 `must_have_limit;must_filter_by_uid`。
- `forbidden_patterns（禁用模式）`：如 `no_unbounded_query`。
- `default_limit/max_limit`：默认与最大返回量。

### 6) `mongo_collection_dictionary.csv`

建议至少填写这些列（必填）：

- `database_name（库名）`：如 `spot`。
- `collection_name（集合名）`：如 `users`。
- `field_path（字段路径）`：支持嵌套路径，如 `profile.email`。
- `bson_type（BSON类型）`：如 `string/number/date/objectId`。
- `business_meaning（业务含义）`：字段业务解释。

建议填写这些列（选填）：

- `is_indexed（有索引）`、`is_filter_hot（高频过滤字段）`：填 `YES/NO`。
- `sample_values（示例值）`：脱敏示例。
- `pii_level（敏感级别）`：`none/low/high`。

### 7) `mongo_relations.csv`

建议至少填写这些列（必填）：

- `relation_id（关系ID）`：唯一编号。
- `left_*` 与 `right_*`：左右集合及字段路径。
- `relation_type（关系类型）`：如 `reference/embedded`。
- `preferred_pattern（推荐模式）`：如 `application_join`、`lookup_pipeline`。
- `typical_query_purpose（典型用途）`：该关系用于什么查询。

### 8) `mongo_enum_dictionary.csv`

建议至少填写这些列（必填）：

- `enum_id（枚举ID）`：唯一编号。
- `database_name/collection_name/field_path`：枚举所在字段。
- `enum_value（枚举值）`、`enum_label（枚举标签）`。
- `business_description（业务说明）`。

## 常见填写错误（避免）

- 只写表名不写库名（错误：`FROM users`，正确：`FROM spot.users`）。
- 不写 `LIMIT` 或 `LIMIT` 太大。
- 用真实敏感数据做示例值。
- `review_status` 长期为空，导致样本无法入库使用。

## 表头格式提醒（重要）

当前 CSV 表头已统一为纯英文键（例如 `case_id`、`expected_sql`、`table_name`）。

- 为避免导入失败，请不要修改首行表头文本。
- 需要写中文说明时，请写在 `notes` 字段，不要改表头。

## 最小可用采集量（MVP）

- `nl2sql_fewshot_cases.csv`：20-50 条。
- `table_dictionary.csv`：5-10 张核心表，关键字段全覆盖。
- `join_relations.csv`：10-20 条常见关联路径。
- `enum_dictionary.csv`：关键业务状态枚举全覆盖。
- `nl2mongo_fewshot_cases.csv`：10-20 条（后续规划，可选提前采集）。
- `mongo_collection_dictionary.csv`：5-10 个核心集合（后续规划，可选提前采集）。
