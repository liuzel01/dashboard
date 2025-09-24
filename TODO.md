# TODO List

This file outlines the current development tasks for the project.

## High Priority

- [ ] 查询中心： 首先在上方选择项目环境。输入 tenant_user_id，根据提供的tenant_user_id，选择右侧的租户，点击查询按钮，会在下方输出：

- 用户详情

- 交易员信息

```sql
select *from spot.tbl_user where tenant_user_id=80016416;
-- 根据查询出来的表数据对应的 id=80327532，根据查出来的 id来查询交易员信息
select * from tiger.copy_trade_user_info where user_id=80327532;
```

## Medium Priority

## Low Priority

- **Documentation: API Documentation**
  - [x] Backend: Add Swagger or a similar tool to generate API documentation for all endpoints.

- **Chore: Update Dependencies**
  - [x] Frontend/Backend: Review and update all outdated npm packages.
