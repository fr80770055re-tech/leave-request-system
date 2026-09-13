/**
 * 家長線上請假系統 - Apps Script 後端
 * 部署方式：Extensions > Apps Script（建議綁定在 Google Sheets 上，
 * 這樣 SpreadsheetApp.getActiveSpreadsheet() 可直接取得試算表，不需另外設定 ID）
 */

const SHEET_NAMES = {
  STUDENTS: "Students",
  CLASS_LINE_GROUPS: "ClassLineGroups",
  LEAVE_REQUESTS: "LeaveRequests",
  WEBHOOK_LOG: "WebhookLog",
};

const LEAVE_TYPES = ["事假", "病假", "喪假", "公假", "生理假", "其他"];
const PERIODS = ["全天", "上午", "下午"];

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

/* ------------------------------------------------------------------ *
 * Web App 進入點
 * ------------------------------------------------------------------ */

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;

    if (action === "getRoster") {
      const roster = getRoster();
      return jsonOutput({ success: true, classes: roster.classes, studentsByClass: roster.studentsByClass });
    }

    return jsonOutput({ success: false, message: "未知的 action" });
  } catch (err) {
    return jsonOutput({ success: false, message: "伺服器錯誤：" + err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE 平台的 webhook 事件會帶 "events" 陣列
    if (body && Array.isArray(body.events)) {
      handleLineWebhook(body);
      return jsonOutput({ success: true });
    }

    if (body && body.action === "submitLeaveRequest") {
      return jsonOutput(submitLeaveRequest(body.data || {}));
    }

    return jsonOutput({ success: false, message: "未知的請求格式" });
  } catch (err) {
    return jsonOutput({ success: false, message: "伺服器錯誤：" + err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ------------------------------------------------------------------ *
 * 前端下拉選單資料
 * ------------------------------------------------------------------ */

// 一次回傳完整的班級/學生名冊，前端只需呼叫一次，選擇班級時就不用再等一次網路請求
function getRoster() {
  const sheet = getSheet(SHEET_NAMES.STUDENTS);
  const rows = sheet.getDataRange().getValues();
  const classes = [];
  const studentsByClass = {};

  for (let i = 1; i < rows.length; i++) {
    const className = String(rows[i][0] || "").trim();
    const studentName = String(rows[i][1] || "").trim();
    if (!className || !studentName) continue;

    if (!studentsByClass[className]) {
      studentsByClass[className] = [];
      classes.push(className);
    }
    studentsByClass[className].push(studentName);
  }
  return { classes: classes, studentsByClass: studentsByClass };
}

/* ------------------------------------------------------------------ *
 * 送出請假申請
 * ------------------------------------------------------------------ */

function submitLeaveRequest(data) {
  const validationError = validateLeaveData(data);
  if (validationError) {
    return { success: false, message: validationError };
  }

  const leaveId = generateLeaveId();
  const submittedAt = new Date();

  const record = {
    leaveId: leaveId,
    submittedAt: submittedAt,
    class: data.class,
    studentName: data.studentName,
    leaveType: data.leaveType,
    otherReason: data.leaveType === "其他" ? data.otherReason : "",
    startDate: data.startDate,
    endDate: data.endDate,
    period: data.period,
    reason: data.reason,
  };

  // 先寫入資料庫，通知結果之後再回填，確保推播失敗不影響假單登記
  const sheet = getSheet(SHEET_NAMES.LEAVE_REQUESTS);
  sheet.appendRow([
    record.leaveId,
    record.submittedAt,
    record.class,
    record.studentName,
    record.leaveType,
    record.otherReason,
    record.startDate,
    record.endDate,
    record.period,
    record.reason,
    "推播中",
  ]);
  const rowIndex = sheet.getLastRow();
  const statusColumn = 11; // LINE推播狀態欄位

  let pushStatus = "失敗";
  try {
    const pushResult = pushLineMessageForClass(record);
    pushStatus = pushResult.success ? "成功" : "失敗：" + pushResult.message;
  } catch (err) {
    pushStatus = "失敗：" + err.message;
  }
  sheet.getRange(rowIndex, statusColumn).setValue(pushStatus);

  return { success: true, leaveId: leaveId };
}

function validateLeaveData(data) {
  if (!data || typeof data !== "object") return "缺少請假資料";
  if (!data.class) return "請選擇班級";
  if (!data.studentName) return "請選擇學生姓名";
  if (LEAVE_TYPES.indexOf(data.leaveType) === -1) return "假別不正確";
  if (data.leaveType === "其他" && !String(data.otherReason || "").trim()) {
    return "請填寫其他假別說明";
  }
  if (!data.startDate) return "請選擇開始日期";
  if (!data.endDate) return "請選擇結束日期";
  if (new Date(data.endDate) < new Date(data.startDate)) return "結束日期不可早於開始日期";
  if (PERIODS.indexOf(data.period) === -1) return "時段不正確";
  if (!String(data.reason || "").trim()) return "請填寫事由";
  return null;
}

function generateLeaveId() {
  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substring(2, 8);
  return "LR" + timestamp + random;
}

/* ------------------------------------------------------------------ *
 * LINE 推播
 * ------------------------------------------------------------------ */

function pushLineMessageForClass(record) {
  const groupSheet = getSheet(SHEET_NAMES.CLASS_LINE_GROUPS);
  const rows = groupSheet.getDataRange().getValues();
  let groupId = "";

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === record.class) {
      groupId = String(rows[i][1] || "").trim();
      break;
    }
  }

  if (!groupId) {
    return { success: false, message: "找不到該班級對應的 LINE 群組" };
  }

  const messageText = buildLineMessageText(record);
  return pushLineMessage(groupId, messageText);
}

function buildLineMessageText(record) {
  const leaveTypeText =
    record.leaveType === "其他" ? "其他（" + record.otherReason + "）" : record.leaveType;

  const dateText =
    record.startDate === record.endDate
      ? formatDate(record.startDate)
      : formatDate(record.startDate) + " ~ " + formatDate(record.endDate);

  return (
    "【請假通知】" +
    record.class +
    " " +
    record.studentName +
    "\n假別：" +
    leaveTypeText +
    "\n日期：" +
    dateText +
    "（" +
    record.period +
    "）" +
    "\n事由：" +
    record.reason
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return Utilities.formatDate(d, "Asia/Taipei", "yyyy/MM/dd");
}

function pushLineMessage(groupId, messageText) {
  const token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) {
    return { success: false, message: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN" };
  }

  const payload = {
    to: groupId,
    messages: [{ type: "text", text: messageText }],
  };

  const response = UrlFetchApp.fetch(LINE_PUSH_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  if (statusCode === 200) {
    return { success: true };
  }
  return { success: false, message: "LINE API 回應碼 " + statusCode + "：" + response.getContentText() };
}

/* ------------------------------------------------------------------ *
 * LINE Webhook（僅供管理者取得群組 ID 使用）
 * ------------------------------------------------------------------ */

function handleLineWebhook(body) {
  const sheet = getSheet(SHEET_NAMES.WEBHOOK_LOG);
  const now = new Date();

  body.events.forEach((event) => {
    const source = event.source || {};
    const groupId = source.groupId || source.roomId || source.userId || "";
    const sourceType = source.type || "";
    sheet.appendRow([now, sourceType, groupId, JSON.stringify(event)]);
  });
}

/* ------------------------------------------------------------------ *
 * 工具函式
 * ------------------------------------------------------------------ */

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error("找不到分頁：" + name + "，請先執行 initSheets() 建立所有分頁");
  }
  return sheet;
}

/**
 * 手動執行一次即可：在 Apps Script 編輯器選擇這個函式並執行，
 * 會自動建立四個分頁與標題列（若已存在則不會重複建立）。
 */
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  createSheetIfMissing(ss, SHEET_NAMES.STUDENTS, ["班級", "學生姓名"]);
  createSheetIfMissing(ss, SHEET_NAMES.CLASS_LINE_GROUPS, ["班級", "LINE群組ID"]);
  createSheetIfMissing(ss, SHEET_NAMES.LEAVE_REQUESTS, [
    "假單ID",
    "提交時間",
    "班級",
    "學生姓名",
    "假別",
    "其他說明",
    "開始日期",
    "結束日期",
    "時段",
    "事由",
    "LINE推播狀態",
  ]);
  createSheetIfMissing(ss, SHEET_NAMES.WEBHOOK_LOG, ["時間", "來源類型", "GroupID", "原始事件JSON"]);
}

function createSheetIfMissing(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
}
