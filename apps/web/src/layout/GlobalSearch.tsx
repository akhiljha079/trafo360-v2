import { SearchOutlined } from "@ant-design/icons";
import { Input } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function GlobalSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");

  return (
    <Input
      prefix={<SearchOutlined />}
      placeholder="Search projects, documents, physical files…"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPressEnter={() => {
        if (value.trim().length < 2) return;
        navigate(`/search?q=${encodeURIComponent(value.trim())}`);
      }}
      style={{ width: 340 }}
      allowClear
    />
  );
}
