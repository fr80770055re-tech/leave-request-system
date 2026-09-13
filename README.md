# 家長線上請假系統

獨立專案（不與「聯絡簿/行事曆」專案共用資料庫），免登入、送出即成立、自動推播 LINE 群組通知。

## 資料夾結構

```
leave-request-system/
├── frontend/            # 部署到 GitHub Pages 的靜態網頁
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── config.js    # 填入 Apps Script Web App 網址
│       └── app.js
├── backend/             # Google Apps Script 後端程式碼
│   ├── Code.gs
│   └── appsscript.json
└── docs/
    └── SETUP.md         # 完整部署與 LINE 串接說明
```

## 目前進度

- [x] 前端表單（班級/學生連動下拉選單、假別、其他說明、日期、時段、事由）
- [x] 後端 Apps Script（`getClassList` / `getStudentsByClass` / `submitLeaveRequest` / webhook 接收）
- [x] Google Sheets 分頁結構與自動建立腳本（`initSheets`）
- [ ] LINE Messaging API 實際串接與測試（Channel Access Token、群組 ID 對照）

詳細部署步驟請見 [docs/SETUP.md](docs/SETUP.md)。
