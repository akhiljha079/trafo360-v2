import { Form, Input, message, Modal } from "antd";
import { api, ApiError } from "../api/client";

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();

  async function onSubmit() {
    const values = await form.validateFields();
    try {
      await api.post("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success("Password changed");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "Failed to change password");
    }
  }

  return (
    <Modal
      title="Change Password"
      open={open}
      onOk={onSubmit}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      okText="Change Password"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="currentPassword" label="Current Password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[{ required: true }, { min: 8, message: "At least 8 characters" }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          dependencies={["newPassword"]}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) return Promise.resolve();
                return Promise.reject(new Error("Passwords do not match"));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
