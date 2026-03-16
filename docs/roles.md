## 后端表结构草案（MySQL）

**`users`**

- `id` (PK)
- `username` (unique)
- `password_hash`
- `status` (active/disabled)
- `last_login_at`
- `created_at` / `updated_at`

**`roles`**

- `id` (PK)
- `name` (unique, 如 admin/operator/viewer)
- `description`
- `created_at` / `updated_at`

**`permissions`**

- `id` (PK)
- `key` (unique, 如 `menu:environments`)
- `name` (展示名)
- `created_at` / `updated_at`

**`user_roles`**

- `user_id`
- `role_id`
- unique(user_id, role_id)

**`role_permissions`**

- `role_id`
- `permission_id`
- unique(role_id, permission_id)

**可选：`audit_logs`**

- `id`
- `actor_user_id`
- `action`
- `target_type` / `target_id`
- `meta` (JSON)
- `created_at`

---

## 权限 key 建议（与菜单对应）

- `menu:environments`
- `menu:s3-upload`
- `menu:deployments`
- `menu:jump-servers`
- `menu:data-query`
- `menu:security-groups`
- `menu:lines`
- `menu:site-monitors`
- `menu:access-control`

---

## API 列表设计（建议）

**认证**

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me` → 返回用户信息 + permissions

**用户**

- `GET /api/users` (分页)
- `POST /api/users`
- `PATCH /api/users/:id` (状态/角色/基础信息)
- `POST /api/users/:id/reset-password`

**角色**

- `GET /api/roles`
- `POST /api/roles`
- `PATCH /api/roles/:id`
- `DELETE /api/roles/:id` (可选)

**权限**

- `GET /api/permissions`
- `PUT /api/roles/:id/permissions` (整包覆盖)

**菜单**

- `GET /api/menu` (可由 `/api/me` 推导，也可独立接口)

---

## 前端权限守卫方案（推荐）

**1. 获取权限**

- 登录后调用 `GET /api/me`，保存 `permissions`。

**2. 过滤菜单**

- 菜单项加 `permissionKey`，只渲染有权限的项。

**3. 路由守卫**

- 每个路由增加 `requiredPermissions`。
- 进入路由时校验，没有权限 -> 跳 403 或重定向首页。

**4. 双重校验**

- 前端仅负责展示控制。
- 后端所有敏感接口必须再次校验权限。
