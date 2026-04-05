import Toast from "react-native-toast-message";

const MSG_BOOKMARK_ADDED = "Added to bookmarks";
const MSG_BOOKMARK_REMOVED = "Removed from bookmarks";
const MSG_ERROR_GENERIC = "Something went wrong. Please try again.";

const MSG_TEL_REPORTED = "Tel reported successfully";
const MSG_TEL_REPORT_REMOVED = "Tel report removed";
const MSG_BANK_REPORTED = "Bank account reported successfully";
const MSG_BANK_REPORT_REMOVED = "Bank account report removed";

function showSuccess(text1: string) {
  Toast.show({
    type: "success",
    text1,
    position: "top",
    topOffset: 56,
  });
}

function showError(text1: string) {
  Toast.show({
    type: "error",
    text1,
    position: "top",
    topOffset: 56,
  });
}

export function toastBookmarkResult(isBookmarked: boolean) {
  showSuccess(isBookmarked ? MSG_BOOKMARK_ADDED : MSG_BOOKMARK_REMOVED);
}

export function toastGenericError() {
  showError(MSG_ERROR_GENERIC);
}

export function toastSuccess(message: string) {
  const text = String(message || "").trim();
  showSuccess(text || "OK");
}

export function toastError(message: string) {
  const text = String(message || "").trim();
  showError(text || MSG_ERROR_GENERIC);
}

export function toastTelReportedSuccessfully() {
  showSuccess(MSG_TEL_REPORTED);
}

export function toastTelReportRemoved() {
  showSuccess(MSG_TEL_REPORT_REMOVED);
}

export function toastBankReportedSuccessfully() {
  showSuccess(MSG_BANK_REPORTED);
}

export function toastBankReportRemoved() {
  showSuccess(MSG_BANK_REPORT_REMOVED);
}
