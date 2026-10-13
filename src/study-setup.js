export const STUDY_TASKS = ["Motion", "Orientation", "Centrality", "Bar"];
export const DEFAULT_STUDY_SETUP = Object.freeze({
  task: "Motion",
  resWidth: 1920,
  resHeight: 1080,
  screenWidth: 47.6,
  screenHeight: 26.8,
  viewingDistance: 50,
  xOffsetDeg: 5,
  yOffsetDeg: 5,
});

export function validateStudySetup(value) {
  if (!value || !STUDY_TASKS.includes(value.task))
    return "Select a study task.";
  for (const key of [
    "resWidth",
    "resHeight",
    "screenWidth",
    "screenHeight",
    "viewingDistance",
  ]) {
    const number = Number(value[key]);
    const resolution = key.startsWith("res");
    if (
      value[key] === "" ||
      value[key] == null ||
      !Number.isFinite(number) ||
      number < (resolution ? 1 : 0.1) ||
      number > 10000 ||
      (resolution && !Number.isInteger(number))
    ) {
      return "Enter valid screen dimensions and distance (maximum 10,000). Resolution must use whole pixels.";
    }
  }
  for (const key of ["xOffsetDeg", "yOffsetDeg"]) {
    if (
      value[key] === "" ||
      value[key] == null ||
      !Number.isFinite(Number(value[key])) ||
      Math.abs(Number(value[key])) >= 90
    )
      return "Offsets must be between −90° and 90°.";
  }
  if (value.task === "Bar" && Number(value.xOffsetDeg) < 0)
    return "Bar X offset must be 0° or greater.";
  return "";
}

export function normalizeStudySetup(value) {
  return Object.fromEntries(
    Object.keys(DEFAULT_STUDY_SETUP).map((key) => [
      key,
      key === "task" ? value[key] : Number(value[key]),
    ]),
  );
}

// Match the experiment's axis-specific angular conversion and average PPD.
export function studyCalibration(value) {
  const pixelsPerCmX = Number(value.resWidth) / Number(value.screenWidth);
  const pixelsPerCmY = Number(value.resHeight) / Number(value.screenHeight);
  const distance = Number(value.viewingDistance);
  return {
    pixelsPerCmX,
    pixelsPerCmY,
    pixelsPerDegree:
      ((pixelsPerCmX + pixelsPerCmY) / 2) * Math.tan(Math.PI / 180) * distance,
    xOffsetPx:
      distance *
      Math.tan((Number(value.xOffsetDeg) * Math.PI) / 180) *
      pixelsPerCmX,
    yOffsetPx:
      distance *
      Math.tan((Number(value.yOffsetDeg) * Math.PI) / 180) *
      pixelsPerCmY,
  };
}
