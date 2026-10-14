import React, { useState, useEffect, useMemo } from "react";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Input,
  Select,
  SelectItem,
  Checkbox,
  Chip,
  Button,
  Pagination,
  Tooltip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Spinner,
} from "@heroui/react";
import { Search, Download, ChartNoAxesCombined } from "lucide-react";
import {
  Panel,
  Notice,
  SessionChip,
  dateLabel,
  timeLabel,
  dateKey,
  durationLabel,
  percentage,
  api,
} from "./ui.jsx";
import { Chart } from "./progress.jsx";
import { STUDY_TASKS } from "../src/study-setup.js";
export function SessionPreview({ reference, onClose }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    if (reference)
      api("/data-portal/api/preview?file=" + encodeURIComponent(reference))
        .then((result) => {
          if (alive) setData(result);
        })
        .catch((err) => {
          if (alive) setError(err.message);
        });
    return () => {
      alive = false;
    };
  }, [reference]);
  return (
    <Modal
      isOpen={!!reference}
      onClose={onClose}
      size="4xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>Session preview</ModalHeader>
        <ModalBody>
          <Notice error>{error}</Notice>
          {!data && !error ? (
            <Spinner label="Loading session…" />
          ) : (
            data && (
              <>
                <div className="preview-context">
                  <SessionChip type={data.file.session_type} />
                  <span>
                    User {data.file.user_id} · {data.file.task_type} ·{" "}
                    {dateLabel(
                      data.file.session_time || data.file.created_at * 1000,
                    )}
                  </span>
                </div>
                <div className="preview-metrics">
                  <div>
                    <span>Trials</span>
                    <strong>{data.metrics.total}</strong>
                  </div>
                  <div>
                    <span>Accuracy</span>
                    <strong>
                      {data.metrics.total
                        ? percentage(
                            (data.metrics.correct * 100) / data.metrics.total,
                          )
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Duration</span>
                    <strong>{durationLabel(data.metrics.totalMs)}</strong>
                  </div>
                  <div>
                    <span>Catch pass rate</span>
                    <strong>
                      {data.metrics.catchTotal
                        ? percentage(
                            (data.metrics.catchCorrect * 100) /
                              data.metrics.catchTotal,
                          )
                        : "—"}
                    </strong>
                  </div>
                </div>
                <Chart type="preview" metrics={data.metrics} />
              </>
            )
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Close
          </Button>
          {data && (
            <Button
              as="a"
              color="primary"
              href={data.file.download_url}
              startContent={<Download size={16} />}
            >
              Download data
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
function DurationBar({ duration }) {
  if (!duration) return <span className="muted">—</span>;
  const training = Math.max(0, Number(duration.trainingMs) || 0);
  const resting = Math.max(0, Number(duration.restingMs) || 0);
  const total = training + resting;
  return (
    <Tooltip content={`${durationLabel(training)} training · ${durationLabel(resting)} break`}>
      <div className="file-duration" tabIndex={0}
        aria-label={`${durationLabel(duration.totalMs)} total: ${durationLabel(training)} training, ${durationLabel(resting)} break`}>
        <span>{durationLabel(duration.totalMs)}</span>
        <div className="file-duration-track" aria-hidden="true">
          <i className="file-duration-training" style={{ width: `${total ? training / total * 100 : 0}%` }} />
          <i className="file-duration-break" style={{ width: `${total ? resting / total * 100 : 0}%` }} />
        </div>
        <small>{durationLabel(resting)} break</small>
      </div>
    </Tooltip>
  );
}
function SanityCheck({ rate }) {
  if (!rate?.total || !Number.isFinite(rate.accuracy)) return <span className="muted">—</span>;
  const tone = rate.accuracy >= 80 ? "success" : rate.accuracy >= 60 ? "warning" : "danger";
  return (
    <Tooltip content={`${rate.correct} of ${rate.total} sanity checks passed`}>
      <Chip size="sm" variant="flat" color={tone}
        aria-label={`Sanity check accuracy: ${percentage(rate.accuracy)}, ${rate.correct} of ${rate.total} passed`}>
        {percentage(rate.accuracy)}
      </Chip>
    </Tooltip>
  );
}
export default function Files({ userId, refreshKey, onPreview }) {
  const [files, setFiles] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [task, setTask] = useState("all"),
    [type, setType] = useState("all"),
    [sessionFiles, setSessionFiles] = useState(false),
    [pauseFiles, setPauseFiles] = useState(false),
    [page, setPage] = useState(1),
    [sort, setSort] = useState({ column: "time", direction: "descending" });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api(
      "/data-portal/api/files?" +
        new URLSearchParams({
          user_id: userId,
          metric_types: "final,session,pause",
        }),
    )
      .then((data) => {
        if (alive) setFiles(data.files);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId, refreshKey]);
  useEffect(() => {
    setPage(1);
  }, [search, from, to, task, type, sessionFiles, pauseFiles]);
  const visible = useMemo(
    () =>
      files
        .filter((file) => {
          if (
            (file.metric_type === "session" && !sessionFiles) ||
            (file.metric_type === "pause" && !pauseFiles) ||
            !["final", "session", "pause"].includes(file.metric_type) ||
            file.status === "backup"
          )
            return false;
          const time =
              file.session_time ||
              new Date(file.created_at * 1000).toISOString(),
            date = dateKey(time);
          return (
            (!from || date >= from) &&
            (!to || date <= to) &&
            (task === "all" || file.task_type === task) &&
            (type === "all" || file.session_type === type) &&
            [
              file.user_id,
              file.session_id,
              file.task_type,
              file.session_type,
              file.status,
            ]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
        .sort((a, b) => {
          const value = (row) =>
            sort.column === "time"
              ? Date.parse(
                  row.session_time ||
                    new Date(row.created_at * 1000).toISOString(),
                )
              : sort.column === "duration"
                ? Number(row.duration?.totalMs || 0)
                : String(row[sort.column] || "");
          const x = value(a),
            y = value(b),
            comparison =
              typeof x === "number"
                ? x - y
                : x.localeCompare(y, undefined, { numeric: true });
          return sort.direction === "ascending" ? comparison : -comparison;
        }),
    [files, search, from, to, task, type, sessionFiles, pauseFiles, sort],
  );
  const pages = Math.max(1, Math.ceil(visible.length / 20)),
    safePage = Math.min(page, pages),
    shown = visible.slice((safePage - 1) * 20, safePage * 20);
  return (
    <Panel
      title="Session data"
      subtitle="Browse recorded sessions and download their original data."
    >
      <div className="file-filters">
        <Input
          aria-label="Search session data"
          placeholder="Search user, task, or session ID"
          value={search}
          onValueChange={setSearch}
          startContent={<Search size={16} />}
          variant="bordered"
          isClearable
        />
        <Input
          type="date"
          label="From"
          labelPlacement="outside-left"
          aria-label="From date"
          value={from}
          onValueChange={setFrom}
          variant="bordered"
        />
        <Input
          type="date"
          label="To"
          labelPlacement="outside-left"
          aria-label="To date"
          value={to}
          onValueChange={setTo}
          variant="bordered"
        />
        <Select
          aria-label="Filter task"
          selectedKeys={[task]}
          onSelectionChange={(keys) => setTask([...keys][0] || "all")}
          variant="bordered"
        >
          <SelectItem key="all">All tasks</SelectItem>
          {STUDY_TASKS.map((item) => (
            <SelectItem key={item}>{item}</SelectItem>
          ))}
        </Select>
        <Select
          aria-label="Filter session type"
          selectedKeys={[type]}
          onSelectionChange={(keys) => setType([...keys][0] || "all")}
          variant="bordered"
        >
          <SelectItem key="all">All session types</SelectItem>
          <SelectItem key="study">Study</SelectItem>
          <SelectItem key="break">Break</SelectItem>
        </Select>
      </div>
      <div className="file-options">
        <Checkbox
          size="sm"
          isSelected={sessionFiles}
          onValueChange={setSessionFiles}
        >
          Include session files
        </Checkbox>
        <Checkbox
          size="sm"
          isSelected={pauseFiles}
          onValueChange={setPauseFiles}
        >
          Include pause files
        </Checkbox>
        <span className="muted">{visible.length} records</span>
      </div>
      <Notice error>{error}</Notice>
      <Table
        aria-label="Session data files"
        removeWrapper
        sortDescriptor={sort}
        onSortChange={setSort}
        classNames={{
          base: "data-table-base",
          table: "data-table",
          th: "data-table-heading",
          td: "data-table-cell",
        }}
      >
        <TableHeader>
          <TableColumn key="user_id" allowsSorting>
            User
          </TableColumn>
          <TableColumn key="session_type" allowsSorting>
            Session type
          </TableColumn>
          <TableColumn key="task_type" allowsSorting>
            Task
          </TableColumn>
          <TableColumn key="time" allowsSorting>
            Time · ET
          </TableColumn>
          <TableColumn key="duration" allowsSorting>
            Duration
          </TableColumn>
          <TableColumn key="sanity">Sanity check accuracy</TableColumn>
          <TableColumn key="actions">Actions</TableColumn>
        </TableHeader>
        <TableBody
          items={shown}
          isLoading={loading}
          loadingContent={<Spinner label="Loading session data…" />}
          emptyContent={
            loading ? "Loading…" : "No session data matches these filters."
          }
        >
          {(file) => (
            <TableRow key={file.reference}>
              <TableCell>{file.user_id || "—"}</TableCell>
              <TableCell>
                <SessionChip type={file.session_type} />
              </TableCell>
              <TableCell>{file.task_type || "—"}</TableCell>
              <TableCell>
                <span className="table-time">
                  {dateLabel(file.session_time || file.created_at * 1000)}
                  <small>
                    {timeLabel(file.session_time || file.created_at * 1000)}
                  </small>
                </span>
              </TableCell>
              <TableCell>
                <DurationBar duration={file.duration} />
              </TableCell>
              <TableCell><SanityCheck rate={file.catch_pass_rate} /></TableCell>
              <TableCell>
                <div className="table-actions">
                  <Button
                    size="sm"
                    variant="flat"
                    className="file-action"
                    aria-label={`Preview session ${file.session_id}`}
                    onPress={() => onPreview(file.reference)}
                    startContent={<ChartNoAxesCombined size={15} />}
                  >
                    Preview
                  </Button>
                  <Button
                    as="a"
                    size="sm"
                    variant="flat"
                    className="file-action"
                    href={file.download_url}
                    aria-label={`Download session ${file.session_id}`}
                    startContent={<Download size={15} />}
                  >
                    Download
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="table-footer">
        <span className="muted">
          {visible.length
            ? `${(safePage - 1) * 20 + 1}–${Math.min(safePage * 20, visible.length)} of ${visible.length}`
            : "0 records"}
        </span>
        {pages > 1 && (
          <Pagination
            total={pages}
            page={safePage}
            onChange={setPage}
            size="sm"
            showControls
          />
        )}
      </div>
    </Panel>
  );
}
