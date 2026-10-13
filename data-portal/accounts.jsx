import React, { useState, useEffect } from "react";
import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Chip,
} from "@heroui/react";
import { Save, Trash2, UserPlus, Eye, EyeOff } from "lucide-react";
import { Panel, Notice, api, dateLabel } from "./ui.jsx";
export function PasswordInput({
  value,
  onValueChange,
  label = "Password",
  required = false,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      label={label}
      labelPlacement="outside"
      type={visible ? "text" : "password"}
      value={value}
      onValueChange={onValueChange}
      minLength={8}
      maxLength={128}
      autoComplete="new-password"
      isRequired={required}
      variant="bordered"
      endContent={
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label={visible ? "Hide password" : "Show password"}
          onPress={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
      }
    />
  );
}
export function AddUserModal({ isOpen, onClose, onSaved }) {
  const [id, setId] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/data-portal/api/users", {
        method: "POST",
        body: JSON.stringify({ user_id: id, password }),
      });
      await onSaved(id);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} isDismissable={!busy}>
      <ModalContent>
        <form onSubmit={save}>
          <ModalHeader>Add user</ModalHeader>
          <ModalBody>
            <Notice error>{error}</Notice>
            <Input
              label="User ID"
              labelPlacement="outside"
              value={id}
              onValueChange={setId}
              pattern="[A-Za-z0-9]{1,32}"
              maxLength={32}
              description="1–32 letters or numbers. Used to sign in and identify study data."
              isRequired
              variant="bordered"
            />
            <PasswordInput
              value={password}
              onValueChange={setPassword}
              required
            />
            <p className="muted">Use a password with at least 8 characters.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose} isDisabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              color="primary"
              startContent={<UserPlus size={16} />}
              isLoading={busy}
            >
              Create user
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
export default function ManageUser({
  user,
  summary,
  onSaved,
  onDeleted,
  onDirtyChange,
}) {
  const [id, setId] = useState(user.user_id),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  const changed = id !== user.user_id || !!password;
  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const save = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await api("/data-portal/api/users", {
        method: "PATCH",
        body: JSON.stringify({
          original_user_id: user.user_id,
          user_id: id,
          password,
        }),
      });
      await onSaved(id);
      setPassword("");
      setMessage("Account updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setError("");
    setBusy(true);
    try {
      await api("/data-portal/api/users", {
        method: "DELETE",
        body: JSON.stringify({ user_id: user.user_id }),
      });
      await onDeleted();
      setConfirm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-layout">
      <Panel
        title="Account details"
        subtitle={`Manage access for User ${user.user_id}.`}
      >
        <form className="account-form" onSubmit={save}>
          <Notice error>{error}</Notice>
          <Notice>{message}</Notice>
          <Input
            label="User ID"
            labelPlacement="outside"
            value={id}
            onValueChange={setId}
            variant="bordered"
            pattern="[A-Za-z0-9]{1,32}"
            maxLength={32}
            description="Changing the ID keeps this user’s data and schedule together."
            isRequired
          />
          <PasswordInput
            label="New password"
            value={password}
            onValueChange={setPassword}
          />
          <p className="muted">
            Leave empty to keep the current password. Changing access signs the
            user out.
          </p>
          <Button
            type="submit"
            color="primary"
            startContent={<Save size={16} />}
            isLoading={busy}
            isDisabled={id === user.user_id && !password}
          >
            Save account
          </Button>
        </form>
        <div className="delete-account">
          <div>
            <h3>Delete account</h3>
            <p className="muted">
              Removes access, setup, and schedules. Recorded experiment data is
              retained.
            </p>
          </div>
          <Button
            color="danger"
            variant="flat"
            startContent={<Trash2 size={16} />}
            onPress={() => setConfirm(true)}
            isDisabled={busy}
          >
            Delete user
          </Button>
        </div>
      </Panel>
      <Panel title="User overview">
        <div className="account-overview">
          <Chip color="primary" variant="flat">
            Participant
          </Chip>
          <dl>
            <div>
              <dt>Created</dt>
              <dd>{dateLabel(user.created_at)}</dd>
            </div>
            <div>
              <dt>Sessions recorded</dt>
              <dd>{summary?.sessions || 0}</dd>
            </div>
            <div>
              <dt>Trials completed</dt>
              <dd>{summary?.trials || 0}</dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd>{user.user_id}</dd>
            </div>
          </dl>
        </div>
      </Panel>
      <Modal
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        isDismissable={!busy}
      >
        <ModalContent>
          <ModalHeader>Delete User {user.user_id}?</ModalHeader>
          <ModalBody>
            <p>
              The user will lose access and their setup and schedules will be
              removed. Recorded experiment data will be kept.
            </p>
            <Notice error>{error}</Notice>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setConfirm(false)}
              isDisabled={busy}
            >
              Cancel
            </Button>
            <Button color="danger" onPress={remove} isLoading={busy}>
              Delete account
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
