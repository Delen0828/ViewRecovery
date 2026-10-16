import React, { useState, useRef, useEffect } from "react";
import { Button, Input, Select, SelectItem, Chip } from "@heroui/react";
import { Save, Monitor, RotateCcw } from "lucide-react";
import { Panel, Notice, api } from "./ui.jsx";
import {
  DEFAULT_STUDY_SETUP,
  STUDY_TASKS,
  studyCalibration,
  validateStudySetup,
  normalizeStudySetup,
} from "../src/study-setup.js";

export default function StudySetup({
  preferences,
  onSaved,
  onDirtyChange,
  admin = false,
}) {
  const [value, setValue] = useState(preferences.setup),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const svgRef = useRef(null),
    drag = useRef(null);
  const validation = validateStudySetup(value);
  const calibrated = validation ? null : studyCalibration(value);
  const edited = JSON.stringify(value) !== JSON.stringify(preferences.setup);
  const changed = !preferences.setup_saved || edited;
  useEffect(() => {
    onDirtyChange(edited);
  }, [edited, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const set = (key, next) => {
    setValue((current) => ({ ...current, [key]: next }));
    setMessage("");
    setError("");
  };
  const fields = (definitions) => (
    <div className="input-pair">
      {definitions.map(([key, label, unit, min, step]) => (
        <Input
          key={key}
          id={key}
          type="number"
          label={label}
          labelPlacement="outside"
          endContent={<span className="input-unit">{unit}</span>}
          value={String(value[key])}
          min={min}
          max={key.includes("Offset") ? 89.9 : 10000}
          step={step}
          onValueChange={(next) => set(key, next)}
          isRequired
          variant="bordered"
        />
      ))}
    </div>
  );
  const updatePointer = (event) => {
    if (!drag.current || !calibrated) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x =
      Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) *
      Number(value.resWidth);
    const y =
      Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) *
      Number(value.resHeight);
    const { dx, dy } = drag.current;
    let xDeg = Math.round(
      (Math.atan(
        ((x - Number(value.resWidth) / 2) * dx) /
          (Number(value.viewingDistance) * calibrated.pixelsPerCmX),
      ) *
        180) /
        Math.PI,
    );
    const yDeg = Math.round(
      (Math.atan(
        ((y - Number(value.resHeight) / 2) * dy) /
          (Number(value.viewingDistance) * calibrated.pixelsPerCmY),
      ) *
        180) /
        Math.PI,
    );
    const xLimit = Math.floor(
      (Math.atan(
        Number(value.screenWidth) / 2 / Number(value.viewingDistance),
      ) *
        180) /
        Math.PI,
    );
    const yLimit = Math.floor(
      (Math.atan(
        Number(value.screenHeight) / 2 / Number(value.viewingDistance),
      ) *
        180) /
        Math.PI,
    );
    xDeg = Math.max(value.task === "Bar" ? 0 : -xLimit, Math.min(xLimit, xDeg));
    setValue((current) => ({
      ...current,
      xOffsetDeg: xDeg,
      yOffsetDeg: Math.max(-yLimit, Math.min(yLimit, yDeg)),
    }));
    setMessage("");
  };
  const w = Number(value.resWidth) || 1920,
    h = Number(value.resHeight) || 1080;
  const positions =
    value.task === "Bar"
      ? [
          { dx: -1, dy: -1, label: "Left bar" },
          { dx: 1, dy: -1, label: "Right bar" },
        ]
      : [{ dx: -1, dy: -1, label: "Left upper" }];
  const grid = [];
  if (calibrated)
    for (const axis of ["x", "y"])
      for (let degree = 1; degree < 90; degree++) {
        const offset =
          Number(value.viewingDistance) *
          Math.tan((degree * Math.PI) / 180) *
          (axis === "x" ? calibrated.pixelsPerCmX : calibrated.pixelsPerCmY);
        if (offset > (axis === "x" ? w : h) / 2) break;
        for (const sign of [-1, 1])
          grid.push(
            <line
              key={`${axis}${degree}${sign}`}
              x1={axis === "x" ? w / 2 + sign * offset : 0}
              x2={axis === "x" ? w / 2 + sign * offset : w}
              y1={axis === "y" ? h / 2 + sign * offset : 0}
              y2={axis === "y" ? h / 2 + sign * offset : h}
              stroke={degree % 5 ? "#dbe1e9" : "#bdc8d7"}
              vectorEffect="non-scaling-stroke"
              strokeWidth={degree % 5 ? 0.6 : 1}
            />,
          );
      }
  const save = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    try {
      const data = await api("/data-portal/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          user_id: preferences.user_id,
          setup: normalizeStudySetup(value),
        }),
      });
      onSaved(data);
      setValue(data.setup);
      setMessage("Study setup saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="setup-layout" onSubmit={save}>
      <Panel
        title="Screen & stimulus"
        subtitle={admin
          ? "Use the same values as this user’s study monitor."
          : "Use the same values as your study monitor."}
        className="setup-fields"
      >
        <Select
          label="Task"
          labelPlacement="outside"
          selectedKeys={[value.task]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next)
              setValue((current) => ({
                ...current,
                task: next,
                xOffsetDeg:
                  next === "Bar"
                    ? Math.abs(Number(current.xOffsetDeg))
                    : current.xOffsetDeg,
              }));
          }}
          variant="bordered"
        >
          {STUDY_TASKS.map((task) => (
            <SelectItem key={task}>{task}</SelectItem>
          ))}
        </Select>
        <div className="field-section">
          <h3>Resolution</h3>
          {fields([
            ["resWidth", "Width", "px", 1, 1],
            ["resHeight", "Height", "px", 1, 1],
          ])}
        </div>
        <div className="field-section">
          <h3>Screen size</h3>
          {fields([
            ["screenWidth", "Width", "cm", 0.1, 0.1],
            ["screenHeight", "Height", "cm", 0.1, 0.1],
          ])}
          <Input
            label="Viewing distance"
            labelPlacement="outside"
            type="number"
            variant="bordered"
            endContent={<span className="input-unit">cm</span>}
            value={String(value.viewingDistance)}
            min={0.1}
            max={10000}
            step={0.1}
            onValueChange={(next) => set("viewingDistance", next)}
            isRequired
          />
        </div>
        <div className="field-section">
          <h3>Stimulus position</h3>
          {fields([
            [
              "xOffsetDeg",
              "X offset",
              "°",
              value.task === "Bar" ? 0 : -89.9,
              0.1,
            ],
            ["yOffsetDeg", "Y offset", "°", -89.9, 0.1],
          ])}
          <p className="muted">
            {calibrated
              ? `X ${calibrated.xOffsetPx.toFixed(1)} px · Y ${calibrated.yOffsetPx.toFixed(1)} px`
              : "Enter valid values to preview."}
          </p>
        </div>
        <Notice error>{error || validation}</Notice>
        <Notice>{message}</Notice>
        <div className="button-row">
          <Button
            type="submit"
            color="primary"
            startContent={<Save size={16} />}
            isLoading={saving}
            isDisabled={!!validation || !changed}
          >
            Save setup
          </Button>
          <Button
            variant="light"
            aria-label="Reset setup to defaults"
            onPress={() => {
              setValue({ ...DEFAULT_STUDY_SETUP, task: value.task });
              setMessage("");
            }}
            startContent={<RotateCcw size={16} />}
          >
            Reset
          </Button>
        </div>
      </Panel>
      <Panel
        title="Monitor preview"
        subtitle="Drag a dot to set the position. Arrow keys adjust by 0.1°; Shift adjusts by 1°."
        actions={
          <Chip variant="flat" startContent={<Monitor size={14} />}>
            1° grid
          </Chip>
        }
        className="monitor-panel"
      >
        <div className="monitor-size-label">
          {value.screenWidth} cm · {value.resWidth} px
        </div>
        <div
          className="study-monitor"
          style={{
            aspectRatio:
              Number(value.screenWidth) / Number(value.screenHeight) || 16 / 9,
          }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            aria-label="Stimulus position preview"
            role="group"
            tabIndex={0}
            onPointerMove={updatePointer}
            onPointerUp={(event) => {
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (
                !calibrated ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const step = event.shiftKey ? 1 : 0.1;
              const key =
                event.key === "ArrowLeft" || event.key === "ArrowRight"
                  ? "xOffsetDeg"
                  : "yOffsetDeg";
              const direction =
                event.key === "ArrowLeft" || event.key === "ArrowUp" ? 1 : -1;
              set(
                key,
                Math.max(
                  key === "xOffsetDeg" && value.task === "Bar" ? 0 : -89.9,
                  Math.min(
                    89.9,
                    Math.round((Number(value[key]) + step * direction) * 10) /
                      10,
                  ),
                ),
              );
            }}
          >
            <rect width={w} height={h} fill="#f0f3f7" />
            {grid}
            <line
              x1={w / 2}
              x2={w / 2}
              y1={0}
              y2={h}
              stroke="#94a3b8"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              x2={w}
              y1={h / 2}
              y2={h / 2}
              stroke="#94a3b8"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={w / 2}
              cy={h / 2}
              r={Math.min(w, h) * 0.008}
              fill="#64748b"
            />
            {calibrated &&
              positions.map(({ dx, dy, label }, index) => {
                const rawX = w / 2 + dx * calibrated.xOffsetPx,
                  rawY = h / 2 + dy * calibrated.yOffsetPx;
                const visible =
                  rawX >= 0 && rawX <= w && rawY >= 0 && rawY <= h;
                const x = Math.max(0, Math.min(w, rawX)),
                  y = Math.max(0, Math.min(h, rawY));
                return (
                  <g key={index}>
                    <line
                      x1={w / 2}
                      y1={h / 2}
                      x2={x}
                      y2={y}
                      stroke="#2563eb"
                      strokeDasharray="5 5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      data-position-marker={index}
                      cx={x}
                      cy={y}
                      r={Math.min(w, h) * 0.025}
                      fill={visible ? "#2563eb" : "#dc2626"}
                      stroke="white"
                      strokeWidth={3}
                      vectorEffect="non-scaling-stroke"
                      className="position-dot"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        drag.current = { dx, dy };
                        svgRef.current.focus();
                        svgRef.current.setPointerCapture(event.pointerId);
                      }}
                    >
                      <title>
                        {label}: drag to adjust
                        {visible ? "" : " (outside the screen)"}
                      </title>
                    </circle>
                  </g>
                );
              })}
          </svg>
          <span className="quadrant q1">Left upper</span>
          <span className="quadrant q2">Right upper</span>
          <span className="quadrant q3">Left lower</span>
          <span className="quadrant q4">Right lower</span>
        </div>
        <p className="muted monitor-caption">
          Height {value.screenHeight} cm · {value.resHeight} px &nbsp; / &nbsp;
          Viewing distance {value.viewingDistance} cm
        </p>
        <div className="calibration-grid">
          <div>
            <span>Pixels / degree</span>
            <strong>{calibrated?.pixelsPerDegree.toFixed(2) || "—"}</strong>
          </div>
          <div>
            <span>Pixels / cm · X</span>
            <strong>{calibrated?.pixelsPerCmX.toFixed(2) || "—"}</strong>
          </div>
          <div>
            <span>Pixels / cm · Y</span>
            <strong>{calibrated?.pixelsPerCmY.toFixed(2) || "—"}</strong>
          </div>
        </div>
        <p className="setup-note">
          These values load automatically when {admin ? "this user enters their" : "you enter your"} User ID
          in the experiment. {admin ? "They" : "You"} can review and adjust them
          before starting training.
        </p>
      </Panel>
    </form>
  );
}
