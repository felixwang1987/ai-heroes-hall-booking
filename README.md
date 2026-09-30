# AI 英雄汇会议室预订

一间重庆办公室会议室的网页预订系统。同事在电脑上预约、修改或取消会议；Windows 平板打开同一网站的展示模式，每 15 秒读取最新日程。页面布局参考原平板照片，新系统从空白预约表开始。

**线上地址：**[电脑预订页面](https://felixwang1987.github.io/ai-heroes-hall-booking/) · [Windows 平板展示页面](https://felixwang1987.github.io/ai-heroes-hall-booking/?mode=display) · [GitHub 源码](https://github.com/felixwang1987/ai-heroes-hall-booking)

电脑端使用部门共用密码，平板端使用单独的只读密码。两个账号的邮箱已配置在网页中，密码只由 Supabase 验证，不保存在 GitHub 仓库。

## 已实现

- 中英双语的今日列表、七天日程、空闲时段、当前状态与下一场会议。
- 08:00–17:00 每 30 分钟预约；12:00–13:00 不可预约。日期、时钟及数据库规则按 `Asia/Shanghai`（北京时间）。
- 会议名称、预订人、日期、时间及可选备注；预订、修改、取消、冲突提示。
- 同事共用一个部门密码。平板使用另一个只读密码；两者都由 Supabase Auth 验证。数据库行级规则限制写入，数据库约束阻止并发预订同一时段。
- 左侧展示中国与马来西亚吉打州（居林）的公共假日；中国调休工作日不会被当作假日。假日数据是经核对的本地快照，覆盖中国 2026 年、吉打州 2026–2027 年；更新方法见下文。

## 系统怎样同步

```text
同事电脑 ───────┐
               ├── GitHub Pages（同一份静态网页）── Supabase Auth + 预约数据库
会议室 Windows 平板 ┘                            ↑
       ?mode=display，只读、每 15 秒更新 ──────────┘
```

GitHub Pages 只提供网页文件，不负责存储预约。使用 GitHub Free 发布 Pages 时，源仓库必须是公开仓库；即使仓库可以私有，Pages 网站本身也公开。因此**不要把密码、service role/secret key、真实会议记录写进仓库**。浏览器可见的 Supabase 项目 URL、publishable key 和登录邮箱可以放在 `src/config.js`；真正的数据权限由 Supabase Auth 和 `supabase/schema.sql` 中的行级规则控制。参考 [GitHub Pages 发布来源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) 和 [Supabase 管理员建用户说明](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。

## 先在本机预览

此仓库无需安装网页依赖。将整个文件夹放在自己的电脑，在文件夹内运行：

```bash
python3 -m http.server 4173
```

打开 `http://localhost:4173/`。未配置 Supabase 时，页面显示**本机演示模式**，输入任意非空密码即可体验，预约只保存在当前浏览器，不能用于正式跨设备预订。平板布局预览地址是 `http://localhost:4173/?mode=display`。

## 接入 Supabase（正式使用前必须完成）

1. 在 [Supabase](https://supabase.com/dashboard) 新建项目。可以使用 GitHub 登录，选择合适的数据存放区域，并保留项目管理员的登录方式。
2. 打开该项目的 **SQL Editor**，复制并运行 [`supabase/schema.sql`](supabase/schema.sql)。它创建角色表、预约表、30 分钟及午休约束、并发时间冲突约束和行级安全规则。只运行一次。
3. 在 **Authentication → Users** 由管理员新增两个密码用户，并确认邮箱。一个是部门预订账号（`booker`），一个是平板只读账号（`display`）。同事只需知道部门预订密码，不需要逐人注册；平板密码只给设备管理员。两个密码必须不同，否则只读账号的隔离就失效。Supabase 管理员建用户可以直接确认邮箱，且不发送邀请邮件；不要把管理员密钥放进网页。
4. 在 SQL Editor 查询这两个用户的 UUID。把邮箱换成刚才创建的两个实际邮箱：

   ```sql
   select id, email from auth.users
   where email in ('booker@example.com', 'display@example.com');
   ```

   然后用查询出的 UUID 绑定角色：

   ```sql
   insert into public.app_roles (user_id, role) values
     ('BOOKER_USER_UUID', 'booker'),
     ('DISPLAY_USER_UUID', 'display');
   ```

5. 在项目设置中复制 **Project URL** 和 **publishable key**，填入 [`src/config.js`](src/config.js) 的 `supabaseUrl`、`supabasePublishableKey`，同时填写两个账号邮箱。`timeZone` 保持 `Asia/Shanghai`。**不要填写密码或任何 secret/service-role key。**
6. 用本机网页测试：同事端使用部门密码登录并预订一条测试会议，另一个浏览器打开 `?mode=display`，使用平板密码登录，等待最多约 15 秒看到更新。再测试修改、取消和冲突提醒。演示模式中的预约不会迁移到云端。

> 如果 Supabase 仪表板无法直接创建并确认密码用户，使用其[官方管理员建用户接口](https://supabase.com/docs/reference/javascript/auth-admin-createuser)在**本机或服务端**创建，设置 `email_confirm: true`。管理员密钥只能在这一步的安全环境中使用，不能进入 `src/config.js` 或 GitHub。

## 发布到 GitHub Pages

1. 在 GitHub 建立一个新的公开仓库，例如 `ai-heroes-hall-booking`，上传本文件夹全部项目文件（不含 `.git`、密码或本地环境文件）。`index.html` 必须位于仓库根目录。
2. 仓库 **Settings → Pages → Build and deployment** 选择 **Deploy from a branch**，分支选 `main`，文件夹选 `/(root)`，保存。
3. 发布后，电脑端使用 `https://你的GitHub用户名.github.io/ai-heroes-hall-booking/`。Windows 平板使用同一地址加 `?mode=display`，首次输入平板专用密码。
4. 平板可用 Microsoft Edge 打开展示地址，按 `F11` 全屏，并在 Windows 电源设置中保持屏幕常亮和联网。保持该网页开启，更新会自动出现。网页或网络中断时，屏幕会提示同步失败；恢复网络后会重新读取。

设置详情见 [GitHub 官方 Pages 指南](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 维护与限制

- 共用部门密码意味着任何知道密码的人都可以修改本部门所有预约；“预订人”字段由填写者自报，不能作为身份认证。请使用足够强的部门密码，并只在部门内分发。平板账号只读。
- Supabase 免费项目如果连续一段时间活动过低，可能暂停；项目管理员收到警告后可登录 Supabase 查看，暂停后可在仪表板恢复。[官方暂停说明](https://supabase.com/docs/guides/platform/free-project-pausing)。
- 节假日列表是 [`src/holidays.js`](src/holidays.js) 中的静态数据。中国 2027 年官方放假安排尚未公布；吉打州 2027 年单独宣布的临时节假日、日期修订和补假也应在官方发布后更新。更新数据、运行测试并重新发布即可生效。代码注释列有原始来源。
- 平板浏览器登录后会在本机保存登录刷新令牌，以便重启网页后继续只读访问；不要把平板作为他人可操作的普通电脑。
- 不做旧 EXE 数据迁移；正式云端预约表从空白开始。

## 测试

项目使用 Node.js 内置测试器，运行 `node --test tests/*.test.mjs`。测试覆盖北京时间边界、时间规则、相邻与重叠会议、本机演示数据、云端权限请求和节假日排序。
