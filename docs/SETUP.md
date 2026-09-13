# 家長線上請假系統 — 部署與設定說明

目前狀態：**表單與後端主體已完成，LINE 推播先以程式碼佔位，尚未串接實際的 Channel Access Token / 群組 ID**。
以下步驟 1～3 可以先完成並測試「送出即寫入 Google Sheets」的完整流程；步驟 4（LINE）會在基本版面確認沒問題後再進行。

## 1. 建立 Google Sheets 試算表

1. 新增一個 Google Sheets 檔案（例如命名為「家長請假系統資料庫」）。
2. 開啟「擴充功能 > Apps Script」，這會建立一個與此試算表綁定的 Apps Script 專案。
3. 把本資料夾 `backend/Code.gs` 的內容貼到 Apps Script 編輯器（可以直接覆蓋預設的 `Code.gs`）。
4. 在 Apps Script 編輯器的函式下拉選單選擇 `initSheets`，按執行。
   - 這會自動建立四個分頁並加上標題列：`Students`、`ClassLineGroups`、`LeaveRequests`、`WebhookLog`。
   - 第一次執行會跳出授權視窗，允許存取即可。
5. 手動在 `Students` 分頁填入班級與學生姓名對照（例如：三年二班 / 王小明）。

### 分頁欄位一覽

**Students**
| 班級 | 學生姓名 |
|---|---|

**ClassLineGroups**（步驟 4 才會用到，先建立空白分頁即可）
| 班級 | LINE群組ID |
|---|---|

**LeaveRequests**（系統自動寫入，不需手動填寫）
| 假單ID | 提交時間 | 班級 | 學生姓名 | 假別 | 其他說明 | 開始日期 | 結束日期 | 時段 | 事由 | LINE推播狀態 |
|---|---|---|---|---|---|---|---|---|---|---|

**WebhookLog**（步驟 4 才會用到）
| 時間 | 來源類型 | GroupID | 原始事件JSON |
|---|---|---|---|

## 2. 部署 Apps Script 為網路應用程式

1. 在 Apps Script 編輯器右上角點「部署 > 新增部署作業」。
2. 類型選擇「網路應用程式」。
3. 設定：
   - 執行身分：**我（本人帳號）**
   - 存取權限：**所有人**
4. 部署後會取得一組網址，格式類似：
   `https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxx/exec`
5. 之後若修改 `Code.gs` 內容，需要「管理部署作業 > 編輯 > 新版本」才會生效，單純儲存程式碼不會更新已部署的網址行為。

## 3. 設定並部署前端（GitHub Pages）

1. 開啟 `frontend/js/config.js`，把 `API_URL` 填成步驟 2 取得的網址：
   ```js
   const API_URL = "https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxx/exec";
   ```
2. 將 `frontend/` 資料夾內容部署到 GitHub Pages（可設定 Pages 來源為此資料夾，或整包搬到獨立的 repo）。
3. 用手機瀏覽器打開網址測試：
   - 班級下拉選單是否能正確載入
   - 選擇班級後學生名單是否正確帶出
   - 送出後 Google Sheets 的 `LeaveRequests` 分頁是否新增一筆資料
   - 此階段 LINE 推播狀態欄位預期會顯示「失敗：尚未設定 LINE_CHANNEL_ACCESS_TOKEN」，這是正常現象，不影響假單登記成功的訊息。

### 為什麼班級/學生清單是讀 `roster.json`，不是即時查 Apps Script？

實測發現 Apps Script Web App 的回應時間很不穩定（多數 2～3 秒，但偶爾會拉長到數十秒），如果每次打開表單都要即時問 Apps Script 要名冊，體驗會時好時壞。所以改成：

- `frontend/roster.json` 是名冊的**靜態快照**，跟網頁一起發布在 GitHub Pages，載入幾乎是瞬間的。
- 只有 `roster.json` 讀不到時，網頁才會退回去問 Apps Script（`action=getRoster`）當備援。
- 送出假單（`submitLeaveRequest`）還是即時打 Apps Script，這個沒辦法避免，但送出本來就是一次性動作，家長可以接受等個幾秒。

**當 `Students` 分頁有異動（轉學生、新增班級等）時，記得同步更新 `roster.json`**，否則表單看到的名冊會是舊的快照。更新方式二選一：
1. 請 Claude 幫你重新產生（在對話裡說「更新名冊」，我會重抓 Google Sheets 資料寫回 `roster.json`）。
2. 手動更新：瀏覽器打開 `你的 exec 網址?action=getRoster`，複製回傳的 JSON，貼進 `frontend/roster.json` 覆蓋（記得保留 `classes` 和 `studentsByClass` 兩個欄位），存檔後重新部署 GitHub Pages。

## 4. LINE Messaging API 串接（稍後進行）

等前 3 步驟確認運作正常後，再進行以下設定（屆時會提供更詳細的操作說明）：

1. 到 LINE Official Account Manager 開啟既有官方帳號的 Messaging API 功能，並連結到 LINE Developers Console。
2. 在 LINE Developers Console 取得 Channel Access Token 與 Channel Secret。
3. 把 Channel Access Token 存入 Apps Script 的 Script Properties：
   - Apps Script 編輯器 > 專案設定 > 指令碼屬性 > 新增屬性
   - 屬性名稱：`LINE_CHANNEL_ACCESS_TOKEN`
   - 值：貼上 Channel Access Token
4. 設定 LINE Developers Console 的 Webhook URL 為本專案部署網址（同一個 `/exec` 網址），並開啟「使用 Webhook」。
5. 把官方帳號加入各班級的 LINE 群組（用官方帳號 LINE ID 或 QR code 邀請）。
6. 群組內任何人發一則訊息，觸發 webhook，Apps Script 會把該次事件的 groupId 記錄到 `WebhookLog` 分頁。
7. 到 `WebhookLog` 分頁複製對應的 groupId，貼到 `ClassLineGroups` 分頁對應的班級列。
8. 之後送出假單時，系統就會自動推播到該班級群組。
