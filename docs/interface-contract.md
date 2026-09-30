# 前端与数据接口约定

UI 文件由界面任务负责：`index.html`、`styles.css`。页面不写内联业务脚本，底部加载 `<script type="module" src="./src/app.js"></script>`。

`src/app.js` 负责所有行为。它通过以下 DOM id 接入页面：

- 主页面：`roomStatus`、`clockReadout`、`todayLabel`、`todayBookings`、`nextMeeting`、`availabilityBar`、`holidayList`、`syncStatus`、`demoBanner`。
- 操作入口：`openBookingBtn`、`openScheduleBtn`、`authButton`。
- 预订弹窗：`bookingDialog`、`bookingForm`、`bookingDialogTitle`、`meetingTitle`、`bookerName`、`meetingDate`、`startTime`、`endTime`、`meetingRemark`、`bookingError`、`bookingSubmit`、`deleteBookingBtn`、`closeBookingBtn`。
- 周视图弹窗：`scheduleDialog`、`scheduleContent`、`scheduleRange`、`prevWeekBtn`、`thisWeekBtn`、`nextWeekBtn`、`weekViewBtn`、`agendaViewBtn`、`closeScheduleBtn`。
- 登录弹窗：`loginDialog`、`loginForm`、`loginPassword`、`loginError`、`closeLoginBtn`。
- 通知：`toast`。

JS 会为 `<body>` 设置 `data-mode="booking|display"`、`data-auth="signed-in|signed-out"`。CSS 在 display 模式隐藏预约/编辑按钮，布局适配 16:9 触屏和桌面。弹窗建议使用原生 `<dialog>`。

云端数据文件由数据任务负责：`src/remote.js`、`src/config.js`、`supabase/schema.sql`、`tests/remote.test.mjs`。`remote.js` 导出 `createRemoteStore(config, deps?)`，其对象接口：

- `signIn(role, password)`，role 为 `booker` 或 `display`；成功后保存会话。
- `restoreSession()`、`signOut()`、`getRole()`。
- `listBookings(fromISO, toISO)`，仅返回 confirmed 预约，按 starts_at 排序。
- `createBooking(payload)`、`updateBooking(id, payload)`、`cancelBooking(id)`。

预约对象字段：`id`, `title`, `booker`, `starts_at`, `ends_at`, `remark`, `status`, `created_at`, `updated_at`。时间以 ISO UTC 传输，页面以办公室时区展示。网络/权限/冲突异常抛出带 `code` 的 Error。`src/config.js` 只放 Supabase URL、publishable key、两个登录 email 和时区，绝不放密码或服务密钥。

演示数据、时间规则和页面控制由主任务负责：`src/domain.js`、`src/demo.js`、`src/app.js`、测试及 README。
