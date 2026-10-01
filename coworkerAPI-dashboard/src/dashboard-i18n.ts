// Dashboard-owned messages only. Never translate provider names, IDs, keys or URLs.
export const DASHBOARD_MESSAGES: Record<string, { vi: string; en: string }> = {
  "settings.anthropic.description": { "vi": "Dùng base URL không có /v1. Gateway nhận request qua Anthropic Messages.", "en": "Use the base URL without /v1. The gateway accepts requests through Anthropic Messages." },
  "settings.openai.description": { "vi": "Dùng base URL có /v1 cho OpenAI Responses và Chat Completions.", "en": "Use the base URL with /v1 for OpenAI Responses and Chat Completions." },
  "settings.authentication": { "vi": "Cấu hình ứng dụng hỗ trợ custom provider tương thích OpenAI hoặc Anthropic bằng endpoint và API key tạo tại trang API keys. Chọn Model ID đang bật tại trang Models. Khả năng sử dụng phụ thuộc vào giao thức và tính năng ứng dụng hỗ trợ.", "en": "Configure an application with an OpenAI-compatible or Anthropic-compatible custom provider using an endpoint and a key from the API keys page. Select an enabled Model ID on the Models page. Compatibility depends on the protocols and features the application supports." },
  "settings.base_url": { "vi": "Base URL", "en": "Base URL" },
  "settings.api_key": { "vi": "API key", "en": "API key" },
  "cleanup.logs.button": { "vi": "Xóa nhật ký", "en": "Clear logs" },
  "cleanup.logs.title": { "vi": "Xóa toàn bộ nhật ký?", "en": "Clear all request logs?" },
  "cleanup.logs.body": { "vi": "Xóa toàn bộ nhật ký request đã lưu, không chỉ 100 bản ghi đang hiển thị. Số liệu Usage, API key và cấu hình được giữ nguyên. Không thể hoàn tác.", "en": "Delete all stored request logs, not just the 100 entries displayed. Usage metrics, API keys, and settings are retained. This cannot be undone." },
  "cleanup.logs.success": { "vi": "Đã xóa nhật ký. Số liệu Usage được giữ nguyên.", "en": "Request logs cleared. Usage metrics were retained." },
  "cleanup.usage.button": { "vi": "Xóa dữ liệu Usage", "en": "Clear usage data" },
  "cleanup.usage.title": { "vi": "Xóa toàn bộ dữ liệu Usage?", "en": "Clear all usage data?" },
  "cleanup.usage.body": { "vi": "Xóa số liệu tổng hợp và đặt lại thống kê Tổng quan. Nhật ký request, API key và cấu hình được giữ nguyên. Request hoàn tất sau khi xóa sẽ được ghi nhận vào số liệu mới. Không thể hoàn tác.", "en": "Delete aggregated metrics and reset Overview statistics. Request logs, API keys, and settings are retained. Requests completed after clearing are recorded in the new metrics. This cannot be undone." },
  "cleanup.usage.success": { "vi": "Đã xóa dữ liệu Usage. Nhật ký được giữ nguyên.", "en": "Usage data cleared. Request logs were retained." },
  "cleanup.usage.coverage": { "vi": "Số liệu được tổng hợp từ lần xóa dữ liệu gần nhất.", "en": "Metrics are aggregated since the last data reset." },
  "status.disabled": { "vi": "Chưa bật", "en": "Disabled" },
  "status.starting": { "vi": "Đang khởi chạy", "en": "Starting" },
  "status.running": { "vi": "Đang chạy", "en": "Running" },
  "status.error": { "vi": "Lỗi", "en": "Error" },
  "status.stopped": { "vi": "Đã dừng", "en": "Stopped" },
  "status.configured": { "vi": "Đã cấu hình", "en": "Configured" },
  "common.wait_for_operation": {
    "vi": "Chờ thao tác hiện tại hoàn tất trước khi đổi ngôn ngữ.",
    "en": "Wait for the current operation to finish before changing the language."
  },
  "tour.progress": {
    "vi": "Bước {current} / {total}",
    "en": "Step {current} / {total}"
  },
  "tour.links.label": { "vi": "Trang cần mở ở bước này", "en": "Pages for this step" },
  "tour.link.tunnels": { "vi": "Mở OpenAI Platform → Tunnels", "en": "Open OpenAI Platform → Tunnels" },
  "tour.link.runtime-keys": { "vi": "Mở API keys → Create new secret key", "en": "Open API keys → Create new secret key" },
  "tour.link.tunnel-docs": { "vi": "Đọc tài liệu Secure MCP Tunnel", "en": "Read the Secure MCP Tunnel documentation" },
  "tour.link.chatgpt-settings": { "vi": "Mở ChatGPT → Settings → Security and login", "en": "Open ChatGPT → Settings → Security and login" },
  "tour.link.plugins": { "vi": "Mở ChatGPT Plugins → tạo plugin mới", "en": "Open ChatGPT Plugins → create a new plugin" },
  "tour.link.activate": { "vi": "Mở hội thoại ChatGPT với lời nhắn kích hoạt", "en": "Open a ChatGPT conversation with the activation message" },
  "tour.images.hint": { "vi": "Bấm vào ảnh để phóng to. Ảnh tham khảo; giao diện có thể khác theo tài khoản hoặc phiên bản.", "en": "Select an image to enlarge it. These are reference images; the interface may vary by account or version." },
  "tour.images.expand": { "vi": "Phóng to ảnh: {name}", "en": "Enlarge image: {name}" },
  "tour.images.title": { "vi": "Ảnh hướng dẫn", "en": "Guide image" },
  "tour.image.plugin-tools": { "vi": "Danh sách công cụ của plugin: trong nhóm Read, kiểm tra có workbench_api_activate. Tên plugin trong ảnh là tên cũ; khi thiết lập mới, đặt tên CoworkerAPI.", "en": "Plugin tool list: check that workbench_api_activate appears in the Read group. The screenshot shows the previous plugin name; use CoworkerAPI for a new setup." },
  "tour.images.close": { "vi": "Đóng", "en": "Close" },
  "tour.image.tunnel": { "vi": "Tạo tunnel: nhập tên, mô tả, chọn organization và ChatGPT workspace của tài khoản sẽ sử dụng.", "en": "Create a tunnel: enter a name and description, then select the organization and ChatGPT workspace for the account you will use." },
  "tour.image.runtime-key": { "vi": "Form Create new secret key: nhập tên, chọn project và thiết lập Permissions theo quyền được cấp. Sao chép khóa ngay sau khi tạo; không gửi khóa vào ChatGPT.", "en": "Create new secret key form: enter a name, select a project, and set Permissions according to your granted access. Copy the key immediately after creation; do not send it to ChatGPT." },
  "tour.image.developer-mode": { "vi": "ChatGPT: Settings → Security and login → bật Developer mode. Tính năng phụ thuộc quyền của tài khoản hoặc workspace.", "en": "ChatGPT: Settings → Security and login → enable Developer mode. Availability depends on account or workspace permissions." },
  "tour.image.plugin": { "vi": "Tạo plugin: đặt tên CoworkerAPI, chọn Connection = Tunnel và tunnel đã tạo. Với cấu hình tunnel của CoworkerAPI, chọn No Auth; client tunnel tự thêm thông tin xác thực MCP.", "en": "Create the plugin: name it CoworkerAPI, choose Connection = Tunnel, and select your tunnel. With CoworkerAPI's tunnel configuration, choose No Auth; the tunnel client supplies MCP authentication." },
  "ui.connected": {
    "vi": "Đã kết nối",
    "en": "Connected"
  },
  "ui.waiting_for_connection": {
    "vi": "Chờ kết nối",
    "en": "Waiting for connection"
  },
  "ui.the_widget_is_connected_to_the_gateway_keep_the": {
    "vi": "Widget đang kết nối với gateway. Giữ hội thoại ChatGPT mở khi sử dụng ứng dụng.",
    "en": "The widget is connected to the gateway. Keep the ChatGPT conversation open while using the client."
  },
  "ui.connect_the_plugin_to_coworkerapi_open_the_bridge_in": {
    "vi": "Kết nối plugin với CoworkerAPI, mở bridge trong ChatGPT và gửi tin nhắn kích hoạt.",
    "en": "Connect the plugin to CoworkerAPI, open the bridge in ChatGPT, and send the activation message."
  },
  "ui.incorrect_password_enter_your_admin_password_again": {
    "vi": "Mật khẩu chưa đúng. Nhập lại mật khẩu quản trị.",
    "en": "Incorrect password. Enter your admin password again."
  },
  "ui.the_password_must_contain_6_to_256_characters": {
    "vi": "Mật khẩu cần từ 6 đến 256 ký tự.",
    "en": "The password must contain 6 to 256 characters."
  },
  "ui.your_session_has_expired_sign_in_again_to_continue": {
    "vi": "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.",
    "en": "Your session has expired. Sign in again to continue."
  },
  "ui.invalid_session_reload_the_page_and_try_again": {
    "vi": "Phiên làm việc không hợp lệ. Tải lại trang và thử lại.",
    "en": "Invalid session. Reload the page and try again."
  },
  "ui.this_action_is_only_available_on_the_machine_running": {
    "vi": "Chỉ có thể thực hiện thao tác này trên máy chạy gateway.",
    "en": "This action is only available on the machine running the gateway."
  },
  "ui.enter_an_api_key_name_with_1_to_80": {
    "vi": "Nhập tên API key từ 1 đến 80 ký tự.",
    "en": "Enter an API key name with 1 to 80 characters."
  },
  "ui.check_the_model_id_provider_and_upstream_model": {
    "vi": "Kiểm tra Model ID, provider và upstream model.",
    "en": "Check the Model ID, provider, and upstream model."
  },
  "ui.check_the_provider_id_type_and_endpoint": {
    "vi": "Kiểm tra ID, loại provider và endpoint.",
    "en": "Check the provider ID, type, and endpoint."
  },
  "ui.enter_a_per_minute_limit_from_1_to_100": {
    "vi": "Nhập giới hạn mỗi phút từ 1 đến 100.000 và giới hạn đồng thời từ 1 đến 1.000.",
    "en": "Enter a per-minute limit from 1 to 100,000 and a concurrent limit from 1 to 1,000."
  },
  "ui.this_provider_is_disabled_enable_it_before_testing_the": {
    "vi": "Provider đang tắt. Bật provider trước khi kiểm tra kết nối.",
    "en": "This provider is disabled. Enable it before testing the connection."
  },
  "ui.this_provider_has_no_api_key_save_a_key": {
    "vi": "Provider chưa có API key. Lưu khóa trước khi kiểm tra kết nối.",
    "en": "This provider has no API key. Save a key before testing the connection."
  },
  "ui.no_supported_adapter_is_available_for_this_provider": {
    "vi": "Provider này chưa có adapter hỗ trợ.",
    "en": "No supported adapter is available for this provider."
  },
  "ui.the_requested_item_was_not_found_refresh_the_page": {
    "vi": "Không tìm thấy mục được yêu cầu. Làm mới trang để cập nhật dữ liệu.",
    "en": "The requested item was not found. Refresh the page to update the data."
  },
  "ui.this_gateway_instance_does_not_support_limit_management": {
    "vi": "Phiên gateway này chưa hỗ trợ quản lý giới hạn.",
    "en": "This gateway instance does not support limit management."
  },
  "ui.default_password_123456_if_you_have_changed_it_enter": {
    "vi": "Mật khẩu mặc định: 123456. Nếu đã đổi, nhập mật khẩu mới.",
    "en": "Default password: 123456. If you have changed it, enter your current password."
  },
  "ui.set_an_admin_password_with_at_least_6_characters": {
    "vi": "Thiết lập mật khẩu quản trị có ít nhất 6 ký tự.",
    "en": "Set an admin password with at least 6 characters."
  },
  "ui.signing_in": {
    "vi": "Đang đăng nhập…",
    "en": "Signing in…"
  },
  "ui.sign_in": {
    "vi": "Đăng nhập",
    "en": "Sign in"
  },
  "ui.no_usage_data": {
    "vi": "Chưa có dữ liệu sử dụng",
    "en": "No usage data"
  },
  "ui.activity_appears_here_when_a_tool_sends_requests_through": {
    "vi": "Khi công cụ gửi request qua gateway, hoạt động sẽ xuất hiện tại đây.",
    "en": "Activity appears here when a tool sends requests through the gateway."
  },
  "ui.unknown": {
    "vi": "chưa rõ",
    "en": "unknown"
  },
  "ui.known": {
    "vi": "đã biết",
    "en": "known"
  },
  "ui.aggregated_since_the_data_store_was_created": {
    "vi": "Tổng hợp từ khi tạo kho dữ liệu.",
    "en": "Aggregated since the data store was created."
  },
  "ui.pre_upgrade_data_includes_only_retained_logs_not_the": {
    "vi": "Dữ liệu trước khi nâng cấp chỉ gồm nhật ký còn được lưu, không bao gồm toàn bộ lịch sử.",
    "en": "Pre-upgrade data includes only retained logs, not the full history."
  },
  "ui.daily_usage_utc": {
    "vi": "Usage theo ngày (UTC)",
    "en": "Daily usage (UTC)"
  },
  "ui.metrics_are_aggregated_by_utc_day_independently_of_the": {
    "vi": "Số liệu được tổng hợp theo ngày UTC, độc lập với giới hạn lưu 1.000 bản ghi nhật ký.",
    "en": "Metrics are aggregated by UTC day, independently of the 1,000-entry log retention limit."
  },
  "ui.understanding_metrics": {
    "vi": "Cách đọc số liệu",
    "en": "Understanding metrics"
  },
  "ui.totals_include_measured_values_only_a_dash_indicates_unknown": {
    "vi": "Tổng chỉ bao gồm giá trị đã đo được. Dấu — biểu thị dữ liệu chưa xác định, không phải 0. Chi phí chưa được tính tự động từ bảng giá.",
    "en": "Totals include measured values only. A dash (—) indicates unknown data, not zero. Costs are not automatically calculated from a pricing table."
  },
  "ui.date": {
    "vi": "Ngày",
    "en": "Date"
  },
  "ui.requests_errors": {
    "vi": "Requests / Lỗi",
    "en": "Requests / Errors"
  },
  "ui.average_latency": {
    "vi": "Độ trễ trung bình",
    "en": "Average latency"
  },
  "ui.known_cost_usd": {
    "vi": "Chi phí USD đã biết",
    "en": "Known cost (USD)"
  },
  "ui.total_requests": {
    "vi": "Tổng requests",
    "en": "Total requests"
  },
  "ui.in_stored_data": {
    "vi": "Trong dữ liệu đã lưu",
    "en": "In stored data"
  },
  "ui.total_errors": {
    "vi": "Tổng lỗi",
    "en": "Total errors"
  },
  "ui.unsuccessful_requests": {
    "vi": "Request không thành công",
    "en": "Unsuccessful requests"
  },
  "ui.days_with_data": {
    "vi": "Ngày có dữ liệu",
    "en": "Days with data"
  },
  "ui.utc_days": {
    "vi": "Ngày UTC",
    "en": "UTC days"
  },
  "ui.unknown_cost_tokens": {
    "vi": "Chi phí / token chưa rõ",
    "en": "Unknown cost / tokens"
  },
  "ui.not_counted_as_zero": {
    "vi": "Không quy đổi thành số 0",
    "en": "Not counted as zero"
  },
  "ui.gateway_activity": {
    "vi": "Hoạt động gateway",
    "en": "Gateway activity"
  },
  "ui.daily_requests_up_to_14_most_recent_days_with": {
    "vi": "Requests theo ngày · tối đa 14 ngày có dữ liệu gần nhất",
    "en": "Daily requests · up to 14 most recent days with data"
  },
  "ui.request_limits": {
    "vi": "Giới hạn request",
    "en": "Request limits"
  },
  "ui.control_request_frequency_and_concurrency_for_each_api_key": {
    "vi": "Kiểm soát tần suất và số request đồng thời cho từng API key trong một tiến trình gateway.",
    "en": "Control request frequency and concurrency for each API key within one gateway process."
  },
  "ui.changes_are_saved_and_apply_immediately_to_new_requests": {
    "vi": "Thay đổi được lưu và có hiệu lực ngay với request mới. Request đang chạy và lịch sử của cửa sổ một phút được giữ nguyên.",
    "en": "Changes are saved and apply immediately to new requests. Active requests and the current one-minute history are retained."
  },
  "ui.scope": {
    "vi": "Phạm vi:",
    "en": "Scope:"
  },
  "ui.these_are_gateway_limits_not_your_chatgpt_account_quota": {
    "vi": "Đây là giới hạn của gateway, không phải quota tài khoản ChatGPT.",
    "en": "These are gateway limits, not your ChatGPT account quota."
  },
  "ui.requests_per_minute": {
    "vi": "Requests/phút",
    "en": "Requests per minute"
  },
  "ui.concurrent_requests": {
    "vi": "Requests đồng thời",
    "en": "Concurrent requests"
  },
  "ui.save_limits": {
    "vi": "Lưu giới hạn",
    "en": "Save limits"
  },
  "ui.saved_the_new_policy_is_effective_immediately": {
    "vi": "Đã lưu. Chính sách mới có hiệu lực ngay.",
    "en": "Saved. The new policy is effective immediately."
  },
  "ui.overview": {
    "vi": "Tổng quan",
    "en": "Overview"
  },
  "ui.connections": {
    "vi": "Kết nối",
    "en": "Connections"
  },
  "ui.logs": {
    "vi": "Nhật ký",
    "en": "Logs"
  },
  "ui.limits": {
    "vi": "Giới hạn",
    "en": "Limits"
  },
  "ui.settings": {
    "vi": "Thiết lập",
    "en": "Settings"
  },
  "ui.loading_data": {
    "vi": "Đang tải dữ liệu…",
    "en": "Loading data…"
  },
  "ui.gateway_for_cli_tools": {
    "vi": "Gateway cho ứng dụng AI",
    "en": "Gateway for AI applications"
  },
  "ui.use_chatgpt_mcp_widget_through_openai_compatible_and_anthropic": {
    "vi": "Sử dụng ChatGPT MCP/widget qua endpoint tương thích OpenAI và Anthropic.",
    "en": "Use ChatGPT MCP/widget through OpenAI-compatible and Anthropic-compatible endpoints."
  },
  "ui.requests_today": {
    "vi": "Requests hôm nay",
    "en": "Requests today"
  },
  "ui.requests_recorded_by_the_gateway": {
    "vi": "Request được gateway ghi nhận",
    "en": "Requests recorded by the gateway"
  },
  "ui.active_api_keys": {
    "vi": "API keys đang hoạt động",
    "en": "Active API keys"
  },
  "ui.keys_that_have_not_been_revoked": {
    "vi": "Khóa chưa bị thu hồi",
    "en": "Keys that have not been revoked"
  },
  "ui.errors_today": {
    "vi": "Lỗi hôm nay",
    "en": "Errors today"
  },
  "ui.requests_that_did_not_complete_successfully": {
    "vi": "Request không hoàn tất thành công",
    "en": "Requests that did not complete successfully"
  },
  "ui.request_processing_time": {
    "vi": "Thời gian xử lý request",
    "en": "Request processing time"
  },
  "ui.forward_requests_between_the_cli_and_the_chatgpt_widget": {
    "vi": "Chuyển tiếp request giữa ứng dụng và widget trong ChatGPT qua plugin/MCP.",
    "en": "Forward requests between the client and the ChatGPT widget through the plugin/MCP connection."
  },
  "ui.open_the_bridge_in_chatgpt_and_send_the_prefilled": {
    "vi": "Mở bridge trong ChatGPT và gửi tin nhắn kích hoạt đã điền sẵn.",
    "en": "Open the bridge in ChatGPT and send the prefilled activation message."
  },
  "ui.open_bridge_in_chatgpt": {
    "vi": "Mở bridge trong ChatGPT",
    "en": "Open bridge in ChatGPT"
  },
  "ui.get_started": {
    "vi": "Bắt đầu",
    "en": "Get started"
  },
  "ui.copy_endpoint": {
    "vi": "Sao chép endpoint",
    "en": "Copy endpoint"
  },
  "ui.connect_the_bridge": {
    "vi": "Kết nối bridge",
    "en": "Connect the bridge"
  },
  "ui.configure_the_tunnel_and_plugin_on_the_connections_page": {
    "vi": "Cấu hình tunnel và plugin tại trang Kết nối, sau đó kích hoạt widget.",
    "en": "Configure the tunnel and plugin on the Connections page, then activate the widget."
  },
  "ui.create_an_api_key": {
    "vi": "Tạo API key",
    "en": "Create an API key"
  },
  "ui.create_a_separate_key_for_each_tool_on_the": {
    "vi": "Tạo khóa riêng cho mỗi công cụ ở mục API keys.",
    "en": "Create a separate key for each tool on the API keys page."
  },
  "ui.configure_cli_tools": {
    "vi": "Thiết lập ứng dụng",
    "en": "Configure AI clients"
  },
  "ui.see_endpoint_and_authentication_settings_for_each_tool_on": {
    "vi": "Xem cấu hình endpoint và xác thực cho từng công cụ tại trang Thiết lập.",
    "en": "See endpoint and authentication settings for each tool on the Settings page."
  },
  "ui.integrations": {
    "vi": "Tích hợp",
    "en": "Integrations"
  },
  "ui.configure_your_tool_with_the_gateway_endpoint_and_a": {
    "vi": "Cấu hình công cụ với endpoint của gateway và API key tạo tại trang API keys.",
    "en": "Configure your tool with the gateway endpoint and a key created on the API keys page."
  },
  "ui.replace_lt_api_key_gt_with_your_key_and": {
    "vi": "Thay &lt;API_KEY&gt; bằng khóa đã tạo và chọn một Model ID đang bật tại trang Models. Claude Code dùng base URL không có /v1; Codex và OpenCode dùng /v1. Mẫu Codex bên dưới chỉ gồm các trường endpoint; cần thêm vào cấu hình provider và thiết lập API key tương ứng.",
    "en": "Replace &lt;API_KEY&gt; with your key and choose an enabled Model ID on the Models page. Claude Code uses a base URL without /v1; Codex and OpenCode use /v1. The Codex example below includes endpoint fields only. Add them to your provider configuration and configure its API key."
  },
  "ui.admin_session": {
    "vi": "Phiên quản trị",
    "en": "Admin session"
  },
  "ui.signing_out_ends_your_admin_session_the_gateway_keeps": {
    "vi": "Đăng xuất kết thúc phiên quản trị. Gateway tiếp tục chạy và các API key vẫn có hiệu lực.",
    "en": "Signing out ends your admin session. The gateway keeps running and API keys remain valid."
  },
  "ui.sign_out": {
    "vi": "Đăng xuất",
    "en": "Sign out"
  },
  "ui.unable_to_load_data": {
    "vi": "Không thể tải dữ liệu",
    "en": "Unable to load data"
  },
  "ui.try_again": {
    "vi": "Thử lại",
    "en": "Try again"
  },
  "ui.api_key_name": {
    "vi": "Tên API key",
    "en": "API key name"
  },
  "ui.public_model_id": {
    "vi": "Model ID công khai",
    "en": "Public Model ID"
  },
  "ui.provider_name": {
    "vi": "Tên provider",
    "en": "Provider name"
  },
  "ui.provider_type": {
    "vi": "Loại provider",
    "en": "Provider type"
  },
  "ui.provider_api_key": {
    "vi": "API key của provider",
    "en": "Provider API key"
  },
  "ui.endpoint_copied": {
    "vi": "Đã sao chép endpoint",
    "en": "Endpoint copied"
  },
  "ui.clipboard_access_is_unavailable_select_the_endpoint_and_copy": {
    "vi": "Không thể truy cập clipboard. Chọn endpoint và sao chép thủ công.",
    "en": "Clipboard access is unavailable. Select the endpoint and copy it manually."
  },
  "ui.processing": {
    "vi": "Đang xử lý…",
    "en": "Processing…"
  },
  "ui.create_and_revoke_authentication_keys_for_coworkerapi_use_a": {
    "vi": "Tạo và thu hồi khóa xác thực với CoworkerAPI. Sử dụng một khóa riêng cho mỗi công cụ.",
    "en": "Create and revoke authentication keys for CoworkerAPI. Use a separate key for each tool."
  },
  "ui.keys_are_shown_only_once_after_creation_coworkerapi_stores": {
    "vi": "Khóa chỉ hiển thị một lần sau khi tạo. CoworkerAPI chỉ lưu giá trị băm SHA-256, không lưu khóa gốc.",
    "en": "Keys are shown only once after creation. CoworkerAPI stores only a SHA-256 hash, not the original key."
  },
  "ui.create_key": {
    "vi": "Tạo khóa",
    "en": "Create key"
  },
  "ui.example_claude_code": {
    "vi": "Ví dụ: Claude Code",
    "en": "Example: Claude Code"
  },
  "ui.never_used": {
    "vi": "Chưa sử dụng",
    "en": "Never used"
  },
  "ui.revoked": {
    "vi": "Đã thu hồi",
    "en": "Revoked"
  },
  "ui.revoke": {
    "vi": "Thu hồi",
    "en": "Revoke"
  },
  "ui.no_api_keys": {
    "vi": "Chưa có API key",
    "en": "No API keys"
  },
  "ui.select_create_key_to_configure_authentication_for_a_cli": {
    "vi": "Chọn Tạo khóa để cấu hình xác thực cho ứng dụng AI.",
    "en": "Select Create key to configure authentication for a AI client."
  },
  "ui.copy_the_key_and_store_it_securely_you_cannot": {
    "vi": "Sao chép khóa và lưu ở nơi an toàn. Khóa không thể xem lại sau khi rời trang.",
    "en": "Copy the key and store it securely. You cannot view it again after leaving this page."
  },
  "ui.api_key_revoked": {
    "vi": "Đã thu hồi API key",
    "en": "API key revoked"
  },
  "ui.map_the_model_id_used_by_your_cli_to": {
    "vi": "Ánh xạ Model ID mà ứng dụng sử dụng tới provider và upstream model.",
    "en": "Map the Model ID used by your client to a provider and upstream model."
  },
  "ui.for_mcp_widget_an_alias_does_not_change_the": {
    "vi": "Với MCP/widget, alias không thay đổi model đang chọn trong ChatGPT Web.",
    "en": "For MCP/widget, an alias does not change the model selected in ChatGPT Web."
  },
  "ui.compatibility_limits": {
    "vi": "Giới hạn tương thích",
    "en": "Compatibility limits"
  },
  "ui.widget_sse_waits_for_the_complete_callback_api_providers": {
    "vi": "SSE của widget chờ callback hoàn chỉnh. Provider API yêu cầu endpoint cùng giao thức: Responses, Chat Completions hoặc Anthropic Messages. Chuyển đổi giữa các giao thức chưa hoàn thiện.",
    "en": "Widget SSE waits for the complete callback. API providers require a matching endpoint protocol: Responses, Chat Completions, or Anthropic Messages. Cross-protocol conversion is not yet complete."
  },
  "ui.enabled": {
    "vi": "Bật",
    "en": "Enabled"
  },
  "ui.save_alias": {
    "vi": "Lưu alias",
    "en": "Save alias"
  },
  "ui.yes": {
    "vi": "Có",
    "en": "Yes"
  },
  "ui.no": {
    "vi": "Không",
    "en": "No"
  },
  "ui.enabled_2": {
    "vi": "Đang bật",
    "en": "Enabled"
  },
  "ui.disabled": {
    "vi": "Đã tắt",
    "en": "Disabled"
  },
  "ui.edit": {
    "vi": "Sửa",
    "en": "Edit"
  },
  "ui.alias_saved_the_configuration_applies_to_the_next_request": {
    "vi": "Đã lưu alias. Cấu hình áp dụng cho request tiếp theo.",
    "en": "Alias saved. The configuration applies to the next request."
  },
  "ui.no_supported_adapter_is_available_for_this_provider_the": {
    "vi": "Provider này chưa có adapter hỗ trợ. Không thể chỉnh sửa alias.",
    "en": "No supported adapter is available for this provider. The alias cannot be edited."
  },
  "ui.100_most_recent_requests": {
    "vi": "100 request gần nhất",
    "en": "100 most recent requests"
  },
  "ui.review_outcomes_protocols_and_latency_for_recent_requests_logs": {
    "vi": "Kiểm tra kết quả, giao thức và độ trễ của các request gần nhất. Nhật ký chỉ lưu metadata, không ghi prompt, tham số công cụ hoặc API key.",
    "en": "Review outcomes, protocols, and latency for recent requests. Logs store metadata only, not prompts, tool arguments, or API keys."
  },
  "ui.understanding_logs": {
    "vi": "Cách đọc nhật ký",
    "en": "Understanding logs"
  },
  "ui.a_dash_indicates_unknown_data_ttft_is_the_time": {
    "vi": "Dấu — biểu thị dữ liệu chưa xác định. TTFT là thời gian đến text delta đầu tiên gateway nhận được; luồng widget chờ callback hoàn chỉnh. Chi phí chưa được ước tính vì chưa có bảng giá.",
    "en": "A dash (—) indicates unknown data. TTFT is the time until the gateway receives the first text delta; the widget flow waits for the complete callback. Costs are not estimated because no pricing table is available."
  },
  "ui.time": {
    "vi": "Thời gian",
    "en": "Time"
  },
  "ui.http_outcome": {
    "vi": "HTTP / Kết quả",
    "en": "HTTP / Outcome"
  },
  "ui.latency_ttft": {
    "vi": "Độ trễ / TTFT",
    "en": "Latency / TTFT"
  },
  "ui.manage_the_sources_that_process_gateway_requests_the_chatgpt": {
    "vi": "Quản lý nguồn xử lý request của gateway. Luồng ChatGPT MCP/widget không yêu cầu thêm provider API.",
    "en": "Manage the sources that process gateway requests. The ChatGPT MCP/widget flow does not require an additional API provider."
  },
  "ui.to_use_an_api_provider_enter_its_endpoint_and": {
    "vi": "Để dùng provider API, nhập endpoint và khóa, lưu provider, sau đó tạo model alias tại trang Models.",
    "en": "To use an API provider, enter its endpoint and key, save the provider, then create a model alias on the Models page."
  },
  "ui.authentication_and_compatibility": {
    "vi": "Xác thực và tương thích",
    "en": "Authentication and compatibility"
  },
  "ui.provider_keys_are_stored_encrypted_leave_the_key_field": {
    "vi": "Khóa provider được lưu mã hóa. Để trống ô khóa khi cập nhật để giữ khóa hiện tại. Provider API chỉ hỗ trợ endpoint cùng giao thức. Kiểm tra kết nối xác minh kết nối và xác thực, không xác nhận một request sinh câu trả lời.",
    "en": "Provider keys are stored encrypted. Leave the key field blank when updating to keep the current key. API providers support matching endpoint protocols only. A connection test checks connectivity and authentication, not response generation."
  },
  "ui.save_provider": {
    "vi": "Lưu provider",
    "en": "Save provider"
  },
  "ui.api_key_not_shown_again": {
    "vi": "API key (không hiển thị lại)",
    "en": "API key (not shown again)"
  },
  "ui.api_key_stored_encrypted": {
    "vi": "API key đã lưu mã hóa",
    "en": "API key stored encrypted"
  },
  "ui.no_api_key_stored": {
    "vi": "Chưa lưu API key",
    "en": "No API key stored"
  },
  "ui.test_connection": {
    "vi": "Kiểm tra kết nối",
    "en": "Test connection"
  },
  "ui.no_providers_added": {
    "vi": "Chưa thêm provider.",
    "en": "No providers added."
  },
  "ui.provider_saved_select_test_connection_to_verify_the_configuration": {
    "vi": "Đã lưu provider. Chọn Kiểm tra kết nối để xác minh cấu hình.",
    "en": "Provider saved. Select Test connection to verify the configuration."
  },
  "ui.checking": {
    "vi": "Đang kiểm tra…",
    "en": "Checking…"
  },
  "ui.connection": {
    "vi": "Kết nối: ",
    "en": "Connection: "
  },
  "ui.authentication": {
    "vi": " · Xác thực: ",
    "en": " · Authentication: "
  },
  "ui.set_up_coworkerapi": {
    "vi": "Thiết lập CoworkerAPI",
    "en": "Set up CoworkerAPI"
  },
  "ui.check_the_tunnel": {
    "vi": "Kiểm tra tunnel",
    "en": "Check the tunnel"
  },
  "ui.configure_the_tunnel": {
    "vi": "Cấu hình tunnel",
    "en": "Configure the tunnel"
  },
  "ui.add_the_plugin_to_chatgpt": {
    "vi": "Thêm plugin vào ChatGPT",
    "en": "Add the plugin to ChatGPT"
  },
  "ui.activate_the_bridge": {
    "vi": "Kích hoạt bridge",
    "en": "Activate the bridge"
  },
  "ui.verify_the_widget_connection": {
    "vi": "Xác nhận kết nối widget",
    "en": "Verify the widget connection"
  },
  "ui.configure_your_cli": {
    "vi": "Cấu hình ứng dụng AI",
    "en": "Configure your client"
  },
  "ui.choose_a_model": {
    "vi": "Chọn model",
    "en": "Choose a model"
  },
  "ui.test_a_cli_request": {
    "vi": "Kiểm tra request từ ứng dụng",
    "en": "Test a client request"
  },
  "ui.set_request_limits": {
    "vi": "Thiết lập giới hạn request",
    "en": "Set request limits"
  },
  "ui.verify_your_setup": {
    "vi": "Kiểm tra thiết lập",
    "en": "Verify your setup"
  },
  "ui.step": {
    "vi": "Bước ",
    "en": "Step "
  },
  "ui.next": {
    "vi": "Tiếp theo",
    "en": "Next"
  },
  "ui.finish_guide": {
    "vi": "Hoàn tất hướng dẫn",
    "en": "Finish guide"
  },
  "ui.the_widget_is_connected_to_the_gateway": {
    "vi": "✓ Widget đang kết nối với gateway.",
    "en": "✓ The widget is connected to the gateway."
  },
  "ui.the_tunnel_process_is_running": {
    "vi": "✓ Tiến trình tunnel đang chạy.",
    "en": "✓ The tunnel process is running."
  },
  "ui.no_heartbeat_received_check_the_widget_in_your_chatgpt": {
    "vi": "Chưa nhận được heartbeat. Kiểm tra widget trong hội thoại ChatGPT.",
    "en": "No heartbeat received. Check the widget in your ChatGPT conversation."
  },
  "ui.the_tunnel_process_is_not_running_continue_to_the": {
    "vi": "Tiến trình tunnel chưa chạy. Tiếp tục đến bước cấu hình.",
    "en": "The tunnel process is not running. Continue to the configuration step."
  },
  "ui.guide_progress_saved": {
    "vi": "Đã lưu tiến độ hướng dẫn.",
    "en": "Guide progress saved."
  },
  "ui.check_the_tunnel_id_client_path_and_runtime_api": {
    "vi": "Kiểm tra Tunnel ID, đường dẫn client và Runtime API key (ít nhất 20 ký tự).",
    "en": "Check the Tunnel ID, client path, and Runtime API key (at least 20 characters)."
  },
  "ui.the_tunnel_id_must_start_with_tunnel_followed_by": {
    "vi": "Tunnel ID cần có dạng tunnel_ và 32 ký tự phía sau. Sao chép lại từ OpenAI Platform.",
    "en": "The Tunnel ID must start with tunnel_ followed by 32 characters. Copy it again from OpenAI Platform."
  },
  "ui.no_valid_runtime_api_key_is_available_paste_a": {
    "vi": "Chưa có Runtime API key hợp lệ. Dán khóa mới từ OpenAI Platform.",
    "en": "No valid Runtime API key is available. Paste a new key from OpenAI Platform."
  },
  "ui.select_download_install_tunnel_client_or_enter_its_full": {
    "vi": "Chọn Tải & cài tunnel-client hoặc nhập đường dẫn đầy đủ trong phần nâng cao trước khi lưu.",
    "en": "Select Download & install tunnel-client or enter its full path under Advanced before saving."
  },
  "ui.no_tunnel_client_was_found_at_the_saved_path": {
    "vi": "Không tìm thấy tunnel-client tại đường dẫn đã lưu. Chọn Tải & cài tunnel-client để cài lại.",
    "en": "No tunnel-client was found at the saved path. Select Download & install tunnel-client to reinstall it."
  },
  "ui.a_tunnel_operation_is_in_progress_wait_for_it": {
    "vi": "Một thao tác tunnel đang chạy. Chờ hoàn tất rồi thử lại.",
    "en": "A tunnel operation is in progress. Wait for it to finish, then try again."
  },
  "ui.unable_to_download_tunnel_client_check_your_internet_connection": {
    "vi": "Không tải được tunnel-client. Kiểm tra Internet rồi thử lại.",
    "en": "Unable to download tunnel-client. Check your internet connection and try again."
  },
  "ui.the_download_has_no_valid_sha_256_checksum_installation": {
    "vi": "Bản tải chưa có checksum SHA-256 hợp lệ. Không cài để bảo đảm an toàn.",
    "en": "The download has no valid SHA-256 checksum. Installation was blocked for safety."
  },
  "ui.the_download_does_not_match_its_sha_256_checksum": {
    "vi": "File tải không khớp checksum SHA-256. Cài đặt đã bị hủy. Tải lại client để tiếp tục.",
    "en": "The download does not match its SHA-256 checksum. Installation was canceled. Download the client again to continue."
  },
  "ui.unable_to_extract_the_client_check_write_permissions_for": {
    "vi": "Không giải nén được client. Kiểm tra quyền ghi thư mục dữ liệu.",
    "en": "Unable to extract the client. Check write permissions for the data directory."
  },
  "ui.unable_to_store_the_encrypted_key_under_the_current": {
    "vi": "Không lưu được khóa mã hóa bằng tài khoản Windows hiện tại.",
    "en": "Unable to store the encrypted key under the current Windows account."
  },
  "ui.saving_tunnel_settings_through_the_dashboard_currently_requires_windows": {
    "vi": "Lưu tunnel qua dashboard hiện hỗ trợ Windows.",
    "en": "Saving tunnel settings through the dashboard currently requires Windows."
  },
  "ui.automatic_installation_currently_supports_windows_x64_arm64": {
    "vi": "Cài tự động hiện hỗ trợ Windows x64/ARM64.",
    "en": "Automatic installation currently supports Windows x64/ARM64."
  },
  "ui.tunnel_management_is_unavailable_in_this_gateway_instance_restart": {
    "vi": "Phiên gateway này chưa bật quản lý tunnel. Khởi động lại phiên bản mới.",
    "en": "Tunnel management is unavailable in this gateway instance. Restart with the updated version."
  },
  "ui.the_operation_failed_check_the_configuration_and_try_again": {
    "vi": "Thao tác chưa thành công. Kiểm tra cấu hình và thử lại.",
    "en": "The operation failed. Check the configuration and try again."
  },
  "ui.the_current_client_has_not_stopped_no_new_client": {
    "vi": "Client hiện tại chưa dừng. Chưa khởi chạy client mới. Chờ và thử lại.",
    "en": "The current client has not stopped. No new client was started. Wait and try again."
  },
  "ui.unable_to_stop_the_current_client_no_new_client": {
    "vi": "Không thể dừng client hiện tại. Chưa khởi chạy client mới để tránh kết nối trùng.",
    "en": "Unable to stop the current client. No new client was started to avoid duplicate connections."
  },
  "ui.connect_to_chatgpt": {
    "vi": "Kết nối với ChatGPT",
    "en": "Connect to ChatGPT"
  },
  "ui.configure_a_tunnel_to_connect_the_chatgpt_plugin_to": {
    "vi": "Cấu hình tunnel để kết nối plugin ChatGPT với gateway trên máy này.",
    "en": "Configure a tunnel to connect the ChatGPT plugin to the gateway on this machine."
  },
  "ui.prepare_a_tunnel_id_linked_to_your_chatgpt_workspace": {
    "vi": "Chuẩn bị Tunnel ID gắn với ChatGPT workspace và Runtime API key có quyền Tunnels Read + Use. Khóa được lưu mã hóa bằng tài khoản Windows hiện tại.",
    "en": "Prepare a Tunnel ID linked to your ChatGPT workspace and a Runtime API key with Tunnels Read + Use permissions. The key is stored encrypted under the current Windows account."
  },
  "ui.create_a_tunnel_in_your_organization_and_link_it": {
    "vi": "Tạo tunnel trong organization và gắn với ChatGPT workspace sẽ sử dụng.",
    "en": "Create a tunnel in your organization and link it to the ChatGPT workspace you will use."
  },
  "ui.open_tunnel_settings": {
    "vi": "Mở trang tạo tunnel ↗",
    "en": "Open tunnel settings ↗"
  },
  "ui.stored_encrypted_leave_blank_to_keep_the_current_key": {
    "vi": "Đã lưu mã hóa — để trống để giữ khóa hiện tại",
    "en": "Stored encrypted — leave blank to keep the current key"
  },
  "ui.paste_runtime_api_key": {
    "vi": "Dán Runtime API key",
    "en": "Paste Runtime API key"
  },
  "ui.use_a_key_with_tunnels_read_use_permissions_this": {
    "vi": "Sử dụng khóa có quyền Tunnels Read + Use. Khóa này chỉ dùng cho tunnel, không dùng để xác thực ứng dụng.",
    "en": "Use a key with Tunnels Read + Use permissions. This key is for the tunnel only, not client authentication."
  },
  "ui.open_runtime_api_keys": {
    "vi": "Mở trang API keys ↗",
    "en": "Open API keys ↗"
  },
  "ui.3_local_tunnel_client": {
    "vi": "3. Tunnel-client trên máy",
    "en": "3. Local tunnel-client"
  },
  "ui.download_install_tunnel_client": {
    "vi": "Tải & cài tunnel-client",
    "en": "Download & install tunnel-client"
  },
  "ui.download_the_client_from_the_openai_repository_verify_sha": {
    "vi": "Tải client từ kho mã nguồn của OpenAI, kiểm tra SHA-256 và cài vào thư mục CoworkerAPI. Cài tự động hỗ trợ Windows x64 và ARM64.",
    "en": "Download the client from the OpenAI repository, verify SHA-256, and install it in the CoworkerAPI directory. Automatic installation supports Windows x64 and ARM64."
  },
  "ui.advanced_use_an_existing_client": {
    "vi": "Nâng cao: dùng client có sẵn",
    "en": "Advanced: use an existing client"
  },
  "ui.full_path_to_tunnel_client_exe": {
    "vi": "Đường dẫn đầy đủ tới tunnel-client.exe",
    "en": "Full path to tunnel-client.exe"
  },
  "ui.example_drive_directory_tunnel_client_exe": {
    "vi": "Ví dụ: ổ đĩa / thư mục / tunnel-client.exe",
    "en": "Example: drive / directory / tunnel-client.exe"
  },
  "ui.enable_the_tunnel_after_saving_and_when_the_gateway": {
    "vi": "Bật tunnel sau khi lưu và khi mở gateway",
    "en": "Enable the tunnel after saving and when the gateway starts"
  },
  "ui.save_start_tunnel": {
    "vi": "Lưu & chạy tunnel",
    "en": "Save & start tunnel"
  },
  "ui.stop_tunnel": {
    "vi": "Dừng tunnel",
    "en": "Stop tunnel"
  },
  "ui.start_saved_tunnel": {
    "vi": "Chạy tunnel đã lưu",
    "en": "Start saved tunnel"
  },
  "ui.next_steps": {
    "vi": "Bước tiếp theo",
    "en": "Next steps"
  },
  "ui.connect_the_plugin_and_widget": {
    "vi": "Kết nối plugin và widget",
    "en": "Connect the plugin and widget"
  },
  "ui.save_and_test_the_tunnel": {
    "vi": "Lưu và kiểm tra tunnel",
    "en": "Save and test the tunnel"
  },
  "ui.select_test_connection_to_confirm_client_readiness_the_running": {
    "vi": "Chọn Kiểm tra kết nối để xác nhận client sẵn sàng. Trạng thái running chỉ xác nhận tiến trình đang chạy.",
    "en": "Select Test connection to confirm client readiness. The running state only confirms that the process is running."
  },
  "ui.add_the_plugin_in_chatgpt": {
    "vi": "Thêm plugin trong ChatGPT",
    "en": "Add the plugin in ChatGPT"
  },
  "ui.enable_developer_mode_open_plugins_then_select_connection_tunnel": {
    "vi": "Bật Developer mode, mở Plugins → +, rồi chọn Connection: Tunnel và tunnel đã cấu hình.",
    "en": "Enable Developer mode, open Plugins → +, then select Connection: Tunnel and your configured tunnel."
  },
  "ui.open_the_widget_in_a_conversation": {
    "vi": "Mở widget trong hội thoại",
    "en": "Open the widget in a conversation"
  },
  "ui.open_the_link_below_select_the_plugin_and_send": {
    "vi": "Mở liên kết bên dưới, chọn plugin và gửi tin nhắn kích hoạt đã điền sẵn.",
    "en": "Open the link below, select the plugin, and send the prefilled activation message."
  },
  "ui.the_connected_state_confirms_the_gateway_is_receiving_widget": {
    "vi": "Trạng thái Đã kết nối xác nhận gateway đang nhận heartbeat từ widget. Giữ hội thoại và widget mở khi sử dụng ứng dụng.",
    "en": "The Connected state confirms the gateway is receiving widget heartbeats. Keep the conversation and widget open while using the client."
  },
  "ui.openai_documentation_connect_to_chatgpt": {
    "vi": "Tài liệu kết nối ChatGPT của OpenAI ↗",
    "en": "OpenAI documentation: connect to ChatGPT ↗"
  },
  "ui.installed_tunnel_client": {
    "vi": "Đã cài tunnel-client ",
    "en": "Installed tunnel-client "
  },
  "ui.enter_the_tunnel_id_and_runtime_api_key_then": {
    "vi": ". Nhập Tunnel ID và Runtime API key, rồi chọn Lưu & chạy tunnel.",
    "en": ". Enter the Tunnel ID and Runtime API key, then select Save & start tunnel."
  },
  "ui.saved_encrypted_settings_and_started_the_tunnel_select_test": {
    "vi": "Đã lưu mã hóa và khởi chạy tunnel. Chọn Kiểm tra kết nối để xác nhận trạng thái sẵn sàng.",
    "en": "Saved encrypted settings and started the tunnel. Select Test connection to confirm readiness."
  },
  "ui.saved_encrypted_settings_the_tunnel_is_disabled": {
    "vi": "Đã lưu mã hóa. Tunnel đang tắt.",
    "en": "Saved encrypted settings. The tunnel is disabled."
  },
  "ui.tunnel_started_select_test_connection_to_confirm_readiness": {
    "vi": "Đã khởi chạy tunnel. Chọn Kiểm tra kết nối để xác nhận trạng thái sẵn sàng.",
    "en": "Tunnel started. Select Test connection to confirm readiness."
  },
  "ui.tunnel_stopped_the_saved_configuration_is_retained": {
    "vi": "Đã dừng tunnel. Cấu hình đã lưu được giữ nguyên.",
    "en": "Tunnel stopped. The saved configuration is retained."
  },
  "ui.skip_to_content": {
    "vi": "Đi đến nội dung",
    "en": "Skip to content"
  },
  "ui.sign_in_to_coworkerapi": {
    "vi": "Đăng nhập CoworkerAPI",
    "en": "Sign in to CoworkerAPI"
  },
  "ui.manage_connections_api_keys_and_gateway_settings": {
    "vi": "Quản lý kết nối, API key và cấu hình gateway.",
    "en": "Manage connections, API keys, and gateway settings."
  },
  "ui.admin_password": {
    "vi": "Mật khẩu quản trị",
    "en": "Admin password"
  },
  "ui.administration_on_the_gateway_machine": {
    "vi": "Quản trị trên máy chạy gateway",
    "en": "Administration on the gateway machine"
  },
  "ui.manage_connections_api_keys_and_gateway_activity": {
    "vi": "Quản lý kết nối, API keys và hoạt động gateway.",
    "en": "Manage connections, API keys, and gateway activity."
  },
  "ui.loading_dashboard": {
    "vi": "Đang tải dashboard…",
    "en": "Loading dashboard…"
  },
  "ui.revoke_api_key": {
    "vi": "Thu hồi API key?",
    "en": "Revoke API key?"
  },
  "ui.after_revocation_this_key_cannot_authenticate_new_requests_this": {
    "vi": "Sau khi thu hồi, khóa không thể xác thực request mới. Thao tác này không thể hoàn tác.",
    "en": "After revocation, this key cannot authenticate new requests. This action cannot be undone."
  },
  "ui.cancel": {
    "vi": "Hủy",
    "en": "Cancel"
  },
  "ui.revoke_key": {
    "vi": "Thu hồi khóa",
    "en": "Revoke key"
  },
  "ui.navigation": {
    "vi": "Thanh điều hướng",
    "en": "Navigation"
  },
  "ui.admin_pages": {
    "vi": "Trang quản lý",
    "en": "Admin pages"
  },
  "ui.setup_guide": {
    "vi": "Hướng dẫn thiết lập",
    "en": "Setup guide"
  },
  "ui.refresh_data": {
    "vi": "Làm mới dữ liệu",
    "en": "Refresh data"
  },
  "ui.toggle_light_and_dark_theme": {
    "vi": "Đổi giao diện sáng tối",
    "en": "Toggle light and dark theme"
  },
  "ui.setup_guide_2": {
    "vi": "HƯỚNG DẪN THIẾT LẬP",
    "en": "SETUP GUIDE"
  },
  "ui.back": {
    "vi": "Quay lại",
    "en": "Back"
  },
  "ui.skip_guide": {
    "vi": "Bỏ qua hướng dẫn",
    "en": "Skip guide"
  },
  "ui.hide_for_now": {
    "vi": "Ẩn tạm",
    "en": "Hide for now"
  },
  "ui.the_tunnel_is_ready_connect_the_plugin_and_activate": {
    "vi": "Tunnel sẵn sàng. Kết nối plugin và kích hoạt widget trong ChatGPT để tiếp tục.",
    "en": "The tunnel is ready. Connect the plugin and activate the widget in ChatGPT to continue."
  },
  "ui.tunnel_readiness_has_not_been_confirmed_check_the_tunnel": {
    "vi": "Tunnel chưa xác nhận sẵn sàng. Kiểm tra Tunnel ID, Runtime API key, kết nối mạng và quyền Tunnels Read + Use.",
    "en": "Tunnel readiness has not been confirmed. Check the Tunnel ID, Runtime API key, network connection, and Tunnels Read + Use permissions."
  },
  "ui.language": {
    "vi": "Ngôn ngữ",
    "en": "Language"
  },
  "ui.request_count_for": {
    "vi": "Số request của ",
    "en": "Request count for "
  },
  "ui.most_recent_days_with_data_detailed_metrics_are_listed": {
    "vi": " ngày có dữ liệu gần nhất; số liệu chi tiết trong bảng bên dưới",
    "en": " most recent days with data; detailed metrics are listed below"
  },
  "tour.welcome.body": {
    "vi": "<p>CoworkerAPI cung cấp endpoint tương thích OpenAI và Anthropic cho các ứng dụng AI thông qua ChatGPT MCP/widget.</p><p>Hướng dẫn này gồm cấu hình tunnel, kết nối ChatGPT, tạo API key và kiểm tra một request từ ứng dụng.</p><p>Chọn <strong>Ẩn tạm</strong> để thao tác ngoài hướng dẫn. Tiến độ được lưu trong trình duyệt.</p>",
    "en": "<p>CoworkerAPI provides OpenAI-compatible and Anthropic-compatible endpoints for AI clients through ChatGPT MCP/widget.</p><p>This guide covers tunnel configuration, connecting ChatGPT, creating an API key, and testing a client request.</p><p>Select <strong>Hide for now</strong> to work outside the guide. Progress is saved in your browser.</p>"
  },
  "tour.tunnel.body": {
    "vi": "<p>Tunnel kết nối máy chạy CoworkerAPI với plugin trong ChatGPT. Cấu hình và quản lý tunnel tại trang <strong>Kết nối</strong>.</p><p>Trạng thái <strong>running</strong> chỉ xác nhận tiến trình client đang chạy. Chọn <strong>Kiểm tra kết nối</strong> để xác nhận client sẵn sàng.</p><p>Kết nối widget được kiểm tra riêng sau khi thêm plugin.</p>",
    "en": "<p>The tunnel connects the machine running CoworkerAPI to the ChatGPT plugin. Configure and manage it on the <strong>Connections</strong> page.</p><p>The <strong>running</strong> state only confirms that the client process is running. Select <strong>Test connection</strong> to confirm client readiness.</p><p>The widget connection is checked separately after adding the plugin.</p>"
  },
  "tour.tunnel-setup.body": {
    "vi": "<ol><li>Mở <a data-tour-link=\"0\">trang tạo tunnel ↗</a> trên OpenAI Platform. Chọn organization và ChatGPT workspace, tạo tunnel, rồi nhập <strong>Tunnel ID</strong>.</li><li>Mở <a data-tour-link=\"1\">API keys ↗</a>, bấm <strong>Create new secret key</strong>. Nhập tên dễ nhận biết, chọn <strong>Project</strong> và thiết lập <strong>Permissions</strong> theo quyền được cấp. Bấm <strong>Create secret key</strong>, sao chép khóa ngay và dán vào ô API key cho tunnel. Quyền sử dụng tunnel cần được cấp ở organization.</li><li>Chọn <strong>Tải & cài tunnel-client</strong>. Dashboard tải client từ OpenAI và kiểm tra SHA-256 trước khi cài.</li><li>Chọn <strong>Bật tunnel</strong>, sau đó chọn <strong>Lưu & chạy tunnel</strong>.</li><li>Chọn <strong>Kiểm tra kết nối</strong>. Kết quả cần xác nhận tunnel sẵn sàng.</li></ol><p><strong>Lưu ý:</strong> Runtime API key được lưu mã hóa trên Windows. Để trống ô khóa khi cập nhật để giữ khóa đã lưu. Không dùng khóa này cho ứng dụng hoặc gửi vào ChatGPT.</p><p>Nếu đã có tunnel hoạt động, sử dụng cấu hình hiện tại. Chọn <strong>Ẩn tạm</strong> để điền biểu mẫu; nút <strong>Hướng dẫn thiết lập</strong> sẽ mở lại bước này.</p><p>Xem <a data-tour-link=\"2\">tài liệu Secure MCP Tunnel ↗</a> nếu cần kiểm tra quyền hoặc workspace.</p>",
    "en": "<ol><li>Open <a data-tour-link=\"0\">tunnel settings ↗</a> on OpenAI Platform. Select your organization and ChatGPT workspace, create a tunnel, and enter its <strong>Tunnel ID</strong>.</li><li>Open <a data-tour-link=\"1\">API keys ↗</a> and select <strong>Create new secret key</strong>. Enter a recognizable name, select a <strong>Project</strong>, and set <strong>Permissions</strong> according to your granted access. Select <strong>Create secret key</strong>, copy the key immediately, and paste it into the tunnel API key field. Tunnel access must be granted at the organization level.</li><li>Select <strong>Download &amp; install tunnel-client</strong>. The dashboard downloads the client from OpenAI and verifies SHA-256 before installation.</li><li>Select <strong>Enable the tunnel</strong>, then select <strong>Save &amp; start tunnel</strong>.</li><li>Select <strong>Test connection</strong>. The result should confirm that the tunnel is ready.</li></ol><p><strong>Note:</strong> The Runtime API key is stored encrypted on Windows. Leave the key field blank when updating to keep the saved key. Do not use this key for AI clients or send it to ChatGPT.</p><p>If a tunnel is already working, use its current configuration. Select <strong>Hide for now</strong> to fill out the form; <strong>Setup guide</strong> reopens this step.</p><p>See the <a data-tour-link=\"2\">Secure MCP Tunnel documentation ↗</a> to check permissions or workspace access.</p>"
  },
  "tour.plugin.body": {
    "vi": "<ol><li><a data-tour-link=\"0\">Mở ChatGPT ↗</a> và đăng nhập tài khoản thuộc workspace đã gắn với tunnel.</li><li>Mở <strong>Settings → Security and login → Developer mode</strong>.</li><li>Mở <a data-tour-link=\"1\">ChatGPT Plugins ↗</a> → <strong>+</strong>. Đặt tên <strong>CoworkerAPI</strong>, chọn <strong>Connection: Tunnel</strong> và tunnel của CoworkerAPI.</li><li>Kiểm tra danh sách công cụ có <code>workbench_api_activate</code>.</li><li>Mở hội thoại mới và chọn plugin từ menu công cụ.</li></ol><p><strong>Lưu ý:</strong> Quyền truy cập và tên menu có thể khác theo tài khoản hoặc workspace. Nếu tunnel không xuất hiện, kiểm tra workspace và quyền <strong>Tunnels Read + Use</strong>.</p><p><a href=\"https://developers.openai.com/plugins/deploy/connect-chatgpt\" target=\"_blank\" rel=\"noopener noreferrer\">Tài liệu kết nối ChatGPT của OpenAI ↗</a></p>",
    "en": "<ol><li><a data-tour-link=\"0\">Open ChatGPT ↗</a> and sign in with an account in the workspace linked to the tunnel.</li><li>Open <strong>Settings → Security and login → Developer mode</strong>.</li><li>Open <a data-tour-link=\"1\">ChatGPT Plugins ↗</a> → <strong>+</strong>. Name the plugin <strong>CoworkerAPI</strong>, select <strong>Connection: Tunnel</strong>, and choose your CoworkerAPI tunnel.</li><li>Verify that the tool list includes <code>workbench_api_activate</code>.</li><li>Open a new conversation and select the plugin from the tools menu.</li></ol><p><strong>Note:</strong> Access and menu names may vary by account or workspace. If the tunnel is missing, check your workspace and <strong>Tunnels Read + Use</strong> permissions.</p><p><a href=\"https://developers.openai.com/plugins/deploy/connect-chatgpt\" target=\"_blank\" rel=\"noopener noreferrer\">OpenAI documentation: connect to ChatGPT ↗</a></p>"
  },
  "tour.activate.body": {
    "vi": "<ol><li>Chọn <a data-tour-link=\"0\">Mở bridge trong ChatGPT ↗</a>. Liên kết mở hội thoại với nội dung kích hoạt đã điền sẵn.</li><li>Chọn plugin CoworkerAPI nếu chưa được chọn, rồi gửi tin nhắn.</li><li>Chờ <code>workbench_api_activate</code> mở widget. Quay lại dashboard để kiểm tra trạng thái.</li></ol><p>Không cần kích hoạt lại khi widget vẫn kết nối.</p>",
    "en": "<ol><li>Select <a data-tour-link=\"0\">Open bridge in ChatGPT ↗</a>. The link opens a conversation with a prefilled activation message.</li><li>Select the CoworkerAPI plugin if it is not already selected, then send the message.</li><li>Wait for <code>workbench_api_activate</code> to open the widget. Return to the dashboard to check its status.</li></ol><p>No further activation is needed while the widget remains connected.</p>"
  },
  "tour.connection.body": {
    "vi": "<p>Trạng thái <strong>Đã kết nối</strong> xác nhận gateway đang nhận heartbeat từ widget. Mở hội thoại hoặc gửi tin nhắn chưa xác nhận kết nối.</p><p>Giữ hội thoại và widget mở trong khi sử dụng ứng dụng.</p><p>Nếu trạng thái vẫn là <strong>Chờ kết nối</strong>, kiểm tra tunnel và plugin, sau đó mở lại liên kết kích hoạt.</p>",
    "en": "<p>The <strong>Connected</strong> state confirms that the gateway is receiving widget heartbeats. Opening a conversation or sending a message does not confirm connectivity.</p><p>Keep the conversation and widget open while using the client.</p><p>If the state remains <strong>Waiting for connection</strong>, check the tunnel and plugin, then open the activation link again.</p>"
  },
  "tour.key.body": {
    "vi": "<ol><li>Nhập tên công cụ, ví dụ <strong>Claude Code</strong>.</li><li>Chọn <strong>Tạo khóa</strong>.</li><li>Sao chép khóa <code>cwapi_…</code> và lưu ở nơi an toàn trước khi rời trang.</li></ol><p><strong>Lưu ý:</strong> Khóa chỉ hiển thị một lần. Đây là khóa xác thực với CoworkerAPI, không phải Runtime API key của tunnel hoặc OpenAI API key.</p>",
    "en": "<ol><li>Enter the tool name, for example <strong>Claude Code</strong>.</li><li>Select <strong>Create key</strong>.</li><li>Copy the <code>cwapi_…</code> key and store it securely before leaving the page.</li></ol><p><strong>Note:</strong> The key is shown only once. It authenticates requests to CoworkerAPI and is not a tunnel Runtime API key or an OpenAI API key.</p>"
  },
  "tour.cli.body": {
    "vi": "<p>Mở phần cấu hình custom provider trong ứng dụng. Sử dụng endpoint tại trang <strong>Thiết lập</strong>, API key đã tạo và một Model ID đang bật.</p><ul><li><strong>Anthropic-compatible:</strong> dùng base URL không có <code>/v1</code>.</li><li><strong>OpenAI-compatible:</strong> dùng base URL có <code>/v1</code>. Chọn Responses hoặc Chat Completions theo giao thức ứng dụng hỗ trợ.</li></ul><p>Áp dụng cho IDE, tiện ích mở rộng, ứng dụng desktop hoặc công cụ dòng lệnh có custom provider tương thích. Khả năng sử dụng phụ thuộc vào giao thức và tính năng ứng dụng yêu cầu, không chỉ việc nhập được URL.</p><p>Không sử dụng Runtime API key của tunnel để xác thực ứng dụng.</p>",
    "en": "<p>Open the custom provider settings in your application. Use an endpoint from <strong>Settings</strong>, your API key, and an enabled Model ID.</p><ul><li><strong>Anthropic-compatible:</strong> use a base URL without <code>/v1</code>.</li><li><strong>OpenAI-compatible:</strong> use a base URL with <code>/v1</code>. Select Responses or Chat Completions according to the protocol your application supports.</li></ul><p>This applies to IDEs, extensions, desktop applications, and command-line tools with a compatible custom provider. Compatibility depends on the protocols and features the application requires, not just accepting a custom URL.</p><p>Do not use the tunnel Runtime API key to authenticate your application.</p>"
  },
  "tour.models.body": {
    "vi": "<p>Đặt model trong ứng dụng thành một <strong>Model ID</strong> đang bật, ví dụ <code>chatgpt-web</code>.</p><p>Model alias ánh xạ request tới provider và upstream model. Với MCP/widget, alias không thay đổi model đang chọn trong ChatGPT Web.</p><p>Luồng MCP/widget không yêu cầu thêm provider API tại trang <strong>Providers</strong>.</p>",
    "en": "<p>Set your client model to an enabled <strong>Model ID</strong>, such as <code>chatgpt-web</code>.</p><p>A model alias maps requests to a provider and upstream model. For MCP/widget, an alias does not change the model selected in ChatGPT Web.</p><p>The MCP/widget flow does not require an additional API provider on the <strong>Providers</strong> page.</p>"
  },
  "tour.usage.body": {
    "vi": "<ol><li>Gửi một yêu cầu ngắn từ ứng dụng, ví dụ trả lời một câu hoặc tạo một file HTML.</li><li>Xác nhận ứng dụng nhận được câu trả lời.</li><li>Mở <strong>Usage</strong> và <strong>Nhật ký</strong> để kiểm tra kết quả, lỗi và độ trễ.</li></ol><p><strong>Giới hạn:</strong> Token và chi phí chưa đo được hiển thị là <strong>—</strong>. SSE của widget chờ callback hoàn chỉnh, không truyền từng token từ ChatGPT.</p>",
    "en": "<ol><li>Send a short request from your client, such as a one-sentence reply or a simple HTML file.</li><li>Verify that the client receives a response.</li><li>Open <strong>Usage</strong> and <strong>Logs</strong> to review the outcome, errors, and latency.</li></ol><p><strong>Limitations:</strong> Unmeasured tokens and costs are displayed as <strong>—</strong>. Widget SSE waits for the complete callback; it does not stream individual tokens from ChatGPT.</p>"
  },
  "tour.limits.body": {
    "vi": "<p>Đặt số request mỗi phút và số request đồng thời cho từng API key. Cấu hình được lưu và áp dụng cho request mới.</p><p>Giới hạn này áp dụng trong gateway, không phải quota của tài khoản ChatGPT.</p><p>Nếu ứng dụng nhận HTTP <code>429</code>, giảm tần suất gửi request hoặc điều chỉnh giới hạn.</p>",
    "en": "<p>Set the requests-per-minute and concurrent request limits for each API key. Settings are saved and apply to new requests.</p><p>These limits apply within the gateway, not to your ChatGPT account quota.</p><p>If your client receives HTTP <code>429</code>, reduce request frequency or adjust the limits.</p>"
  },
  "tour.finish.body": {
    "vi": "<p>Trước khi sử dụng, xác nhận:</p><ul><li>Tunnel sẵn sàng.</li><li>Plugin có công cụ <code>workbench_api_activate</code>.</li><li>Widget hiển thị <strong>Đã kết nối</strong>.</li><li>ứng dụng dùng đúng endpoint, API key và Model ID.</li><li>Một request thử nghiệm đã trả về câu trả lời trong ứng dụng.</li></ul><p><strong>Hoàn tất hướng dẫn</strong> chỉ lưu tiến độ, không xác nhận kết nối. Nếu request chưa thành công, kiểm tra trạng thái bridge và Nhật ký.</p><p>Mở lại hướng dẫn từ nút <strong>Hướng dẫn thiết lập</strong> trên thanh đầu trang.</p>",
    "en": "<p>Before use, verify that:</p><ul><li>The tunnel is ready.</li><li>The plugin includes <code>workbench_api_activate</code>.</li><li>The widget shows <strong>Connected</strong>.</li><li>The client uses the correct endpoint, API key, and Model ID.</li><li>A test request returned a response in the client.</li></ul><p><strong>Finish guide</strong> saves progress only; it does not verify connectivity. If the request failed, check the bridge status and Logs.</p><p>Reopen the guide with <strong>Setup guide</strong> in the page header.</p>"
  }
};

export function dashboardMessageKey(text: string): string {
  return Object.keys(DASHBOARD_MESSAGES).find(key => DASHBOARD_MESSAGES[key].vi === text) ?? text;
}

export const DASHBOARD_I18N_SCRIPT = `
const dashboardMessages=${JSON.stringify(DASHBOARD_MESSAGES).replace(/</g,'\\u003c')};
let dashboardLocale='vi';
let localeSwitching=false;
try{const saved=localStorage.getItem('coworkerapi.locale');if(saved==='en'||saved==='vi')dashboardLocale=saved}catch{}
function t(key,params={}){const entry=dashboardMessages[key];const text=entry?.[dashboardLocale]??entry?.vi??key;return text.replace(/\\{(\\w+)\\}/g,(_,name)=>String(params[name]??'{'+name+'}'))}
function translateShell(){
  document.documentElement?.setAttribute('lang',dashboardLocale);
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  for(const attr of ['aria-label','title','placeholder'])document.querySelectorAll('[data-i18n-'+attr+']').forEach(el=>el.setAttribute(attr,t(el.getAttribute('data-i18n-'+attr))));
  document.querySelectorAll('[data-locale-select]').forEach(el=>{el.value=dashboardLocale});
  const login=$('auth-form')?.querySelector?.('button');if(login&&!login.disabled)login.textContent=t('ui.sign_in');
}
function translatedMessage(message){for(const [key,entry] of Object.entries(dashboardMessages))if(message===entry.vi||message===entry.en)return t(key);return message}
function tunnelStateLabel(state){return dashboardMessages['status.'+state]?t('status.'+state):state}
async function changeDashboardLocale(locale){
  if(!['vi','en'].includes(locale)||locale===dashboardLocale)return;
  if(localeSwitching||document.querySelector('#content [data-busy="true"],#auth-form button:disabled,[data-revoke]:disabled,[data-test-provider]:disabled')){
    document.querySelectorAll('[data-locale-select]').forEach(el=>el.value=dashboardLocale);
    notify(t('common.wait_for_operation'));return;
  }
  localeSwitching=true;
  document.querySelectorAll('[data-locale-select]').forEach(el=>el.disabled=true);
  try{
  const inputs=[...document.querySelectorAll('#content input,#content select')].map(el=>({id:el.id,value:el.value,checked:el.checked,disabled:el.disabled}));
  const secret=$('new-key')?.querySelector('.secret');
  const messages=['message','feedback','tunnel-result','model-result','provider-result','limits-result','key-error'].map(id=>({id,value:$(id)?.textContent}));
  const focus=document.activeElement?.id;
  const selection=document.activeElement?.selectionStart;
  dashboardLocale=locale;try{localStorage.setItem('coworkerapi.locale',locale)}catch{}
  translateShell();
  if(csrf){
    await render();
    for(const item of inputs){const el=$(item.id);if(el){el.value=item.value;el.disabled=item.disabled;if(el.type==='checkbox')el.checked=item.checked}}
    if(secret&&$('new-key')){$('new-key').append(secret);const note=document.createElement('p');note.className='notice';note.textContent=t('ui.copy_the_key_and_store_it_securely_you_cannot');$('new-key').append(note)}
  }
  if(!csrf)await init();
  dashboardTour.relocalize?.();
  for(const item of messages){const el=$(item.id);if(el&&item.value)el.textContent=translatedMessage(item.value)}
  const focused=$(focus);if(focused){focused.focus({preventScroll:true});if(typeof selection==='number'&&typeof focused.setSelectionRange==='function')try{focused.setSelectionRange(selection,selection)}catch{}}
  }finally{localeSwitching=false;document.querySelectorAll('[data-locale-select]').forEach(el=>el.disabled=false)}
}
document.querySelectorAll('[data-locale-select]').forEach(el=>el.onchange=()=>{changeDashboardLocale(el.value).catch(()=>notify(t('ui.unable_to_load_data')))});
translateShell();
`;
