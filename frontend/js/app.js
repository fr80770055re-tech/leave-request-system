(function () {
  const classSelect = document.getElementById("classSelect");
  const studentSelect = document.getElementById("studentSelect");
  const leaveType = document.getElementById("leaveType");
  const otherReasonField = document.getElementById("otherReasonField");
  const otherReason = document.getElementById("otherReason");
  const startDate = document.getElementById("startDate");
  const startDateLabel = document.getElementById("startDateLabel");
  const sameDayCheckbox = document.getElementById("sameDayCheckbox");
  const endDateField = document.getElementById("endDateField");
  const endDate = document.getElementById("endDate");
  const reason = document.getElementById("reason");
  const form = document.getElementById("leaveForm");
  const submitBtn = document.getElementById("submitBtn");
  const resultBanner = document.getElementById("resultBanner");

  function showBanner(message, type) {
    resultBanner.textContent = message;
    resultBanner.className = "banner " + type;
    resultBanner.hidden = false;
  }

  function hideBanner() {
    resultBanner.hidden = true;
  }

  function apiConfigured() {
    return typeof API_URL === "string" && API_URL.trim().length > 0;
  }

  async function apiGet(params) {
    const url = new URL(API_URL);
    Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error("網路連線異常");
    return res.json();
  }

  async function apiPost(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      // 使用 text/plain 避免瀏覽器對 Apps Script 觸發 CORS 預檢請求（Apps Script 不處理 OPTIONS）
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("網路連線異常");
    return res.json();
  }

  let studentsByClass = {};

  function fillClassSelect(classes) {
    classSelect.innerHTML = '<option value="" disabled selected>請選擇班級</option>';
    classes.forEach((cls) => {
      const opt = document.createElement("option");
      opt.value = cls;
      opt.textContent = cls;
      classSelect.appendChild(opt);
    });
  }

  // roster.json 是隨網頁一起發布的靜態名冊快照，跟網頁同一個網域，載入幾乎即時，
  // 避免每次都要等 Apps Script（實測偶爾會慢達數十秒）。只有這個檔案讀不到時才回頭問 Apps Script。
  async function loadRosterFromStaticFile() {
    const res = await fetch("roster.json", { cache: "no-store" });
    if (!res.ok) throw new Error("roster.json not found");
    return res.json();
  }

  async function loadRosterFromApi() {
    if (!apiConfigured()) {
      throw new Error("API_URL not configured");
    }
    return apiGet({ action: "getRoster" });
  }

  async function loadRoster() {
    let data;
    try {
      data = await loadRosterFromStaticFile();
    } catch (staticErr) {
      try {
        data = await loadRosterFromApi();
      } catch (apiErr) {
        showBanner("無法載入班級清單，請稍後重新整理頁面再試一次。", "error");
        return;
      }
    }
    studentsByClass = (data && data.studentsByClass) || {};
    fillClassSelect((data && data.classes) || []);
  }

  function populateStudents(cls) {
    const students = studentsByClass[cls] || [];
    studentSelect.innerHTML = '<option value="" disabled selected>請選擇學生姓名</option>';
    students.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      studentSelect.appendChild(opt);
    });
    studentSelect.disabled = false;
  }

  classSelect.addEventListener("change", () => {
    hideBanner();
    if (classSelect.value) {
      populateStudents(classSelect.value);
    }
  });

  leaveType.addEventListener("change", () => {
    const isOther = leaveType.value === "其他";
    otherReasonField.hidden = !isOther;
    otherReason.required = isOther;
    if (!isOther) otherReason.value = "";
  });

  function isSameDay() {
    return sameDayCheckbox.checked;
  }

  function getEffectiveEndDate() {
    return isSameDay() ? startDate.value : endDate.value;
  }

  function updateEndDateMode() {
    const sameDay = isSameDay();
    endDateField.hidden = sameDay;
    endDate.required = !sameDay;
    startDateLabel.textContent = sameDay ? "請假日期" : "開始日期";
    if (sameDay) {
      endDate.value = startDate.value;
    } else if (startDate.value) {
      endDate.min = startDate.value;
      if (endDate.value && endDate.value < startDate.value) {
        endDate.value = startDate.value;
      }
    }
  }

  sameDayCheckbox.addEventListener("change", () => {
    hideBanner();
    updateEndDateMode();
  });

  startDate.addEventListener("change", () => {
    hideBanner();
    updateEndDateMode();
  });

  updateEndDateMode();

  function validateForm() {
    if (!classSelect.value) return "請選擇班級";
    if (!studentSelect.value) return "請選擇學生姓名";
    if (!leaveType.value) return "請選擇假別";
    if (leaveType.value === "其他" && !otherReason.value.trim()) return "請填寫其他假別說明";
    if (!startDate.value) return "請選擇開始日期";
    const effectiveEndDate = getEffectiveEndDate();
    if (!isSameDay() && !effectiveEndDate) return "請選擇結束日期";
    if (effectiveEndDate < startDate.value) return "結束日期不可早於開始日期";
    if (!reason.value.trim()) return "請填寫事由";
    return null;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideBanner();

    const error = validateForm();
    if (error) {
      showBanner(error, "error");
      return;
    }

    if (!apiConfigured()) {
      showBanner("尚未設定後端網址，請聯繫系統管理者。", "error");
      return;
    }

    const period = form.querySelector('input[name="period"]:checked').value;

    const payload = {
      action: "submitLeaveRequest",
      data: {
        class: classSelect.value,
        studentName: studentSelect.value,
        leaveType: leaveType.value,
        otherReason: leaveType.value === "其他" ? otherReason.value.trim() : "",
        startDate: startDate.value,
        endDate: getEffectiveEndDate(),
        period: period,
        reason: reason.value.trim(),
      },
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中...";

    try {
      const result = await apiPost(payload);
      if (result && result.success) {
        showBanner("假單已登記成功！", "success");
        form.reset();
        otherReasonField.hidden = true;
        studentSelect.innerHTML = '<option value="" disabled selected>請先選擇班級</option>';
        studentSelect.disabled = true;
        sameDayCheckbox.checked = true;
        endDate.min = "";
        updateEndDateMode();
      } else {
        showBanner((result && result.message) || "送出失敗，請確認欄位後再試一次。", "error");
      }
    } catch (err) {
      showBanner("送出失敗，請檢查網路連線後再試一次。", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出請假申請";
    }
  });

  loadRoster();
})();
