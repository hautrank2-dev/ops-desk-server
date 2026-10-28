---
description: Ý tưởng tổng quát để xây một "async select" (dropdown tìm kiếm, phân trang, lazy-load dữ liệu từ server) dùng chung cho nhiều loại object khác nhau. Đọc trước khi tạo mới hoặc chỉnh sửa bất kỳ select nào gắn với dữ liệu server.
paths:
  - "src/components/selects/**"
---

# Async Select — đặc tả tổng quát

Tài liệu này mô tả **ý tưởng**, không phải code cụ thể của một project. Mục
tiêu: bất kỳ agent AI nào, ở bất kỳ project nào (khác framework, khác thư viện
query, khác UI kit) đọc xong đều dựng lại được một "async select" đúng tinh
thần, áp dụng cho bất kỳ loại object nào (kho, sản phẩm, đơn hàng, người
dùng, ...) mà không phải viết lại logic tìm kiếm/phân trang/cache từ đầu.

## 1. Vấn đề cần giải quyết

Một select thường gặp các yêu cầu sau, và **không nên** giải quyết riêng lẻ
cho từng loại object:

- Danh sách option đến từ API, không phải mảng tĩnh trong code.
- Danh sách có thể rất lớn → phải tìm kiếm (search) trên server, không tải
  hết về client.
- Kết quả tìm kiếm phải phân trang (infinite scroll khi cuộn xuống cuối
  danh sách hiện có).
- Khi select đã có sẵn giá trị (ví dụ form Edit), phải hiển thị được nhãn
  (label) của giá trị đó ngay cả khi item đó chưa nằm trong trang dữ liệu
  hiện tại — không được hiển thị id thô hoặc để trống.
- Phải có trạng thái loading, trạng thái rỗng, debounce khi gõ tìm kiếm.
- Phải tái sử dụng được cho nhiều loại object khác nhau mà không copy-paste
  toàn bộ component mỗi lần thêm một entity mới.

=> Giải pháp: tách thành **một engine tổng quát, không biết gì về entity cụ
thể**, và mỗi entity chỉ cung cấp một "adapter" nhỏ (cách fetch + cách map dữ
liệu thô sang option).

## 2. Kiến trúc 3 lớp

```
Lớp 1 — Core engine (generic, KHÔNG import bất kỳ API/entity nào)
  "AsyncSelect" / "EntitySelect"
  - Nhận vào: value, onChange, fetchPage, fetchOne, render tuỳ biến...
  - Tự lo: debounce, infinite query, cache nhãn, loading/empty, clear...

Lớp 2 — Form-bound wrapper (generic, chỉ biết về thư viện form)
  "AsyncSelectField" / "EntitySelectField"
  - Bọc Lớp 1 bằng Controller/Field của form library (label, error, required)
  - Vẫn không biết object cụ thể là gì — nhận adapter qua props giống Lớp 1

Lớp 3 — Concrete instances (biết cụ thể entity, gọi API thật)
  "WarehouseSelect" / "WarehouseSelectField"
  "SkuSelect" / "SkuSelectField"
  ...
  - Mỗi entity chỉ viết: 1 hàm fetchPage, 1 hàm fetchOne, cách map field
    "value/name/code", (tuỳ chọn) renderOption/renderInfo riêng.
  - Không viết lại UI, không viết lại debounce/pagination/cache.
```

Nguyên tắc bắt buộc: **thêm một entity mới không được đụng vào Lớp 1 và Lớp
2**. Nếu phải sửa engine để phục vụ riêng một entity, nghĩa là contract ở
Lớp 1 đang thiếu — mở rộng contract (thêm prop tuỳ biến) chứ không nhúng
logic riêng của entity vào engine.

## 3. Hợp đồng dữ liệu (data contract) của Lớp 1

Engine chỉ làm việc với 2 khái niệm trừu tượng:

```ts
type Option = {
  value: string;       // id thực, dùng làm giá trị select + key
  name: string;         // nhãn hiển thị chính
  code: string;          // nhãn phụ (mã), có thể rỗng nếu entity không có
  data?: unknown;        // bản ghi gốc — để renderOption/renderInfo tuỳ biến
};

type Page = {
  items: Option[];
  hasNext: boolean;
  pageIndex: number;
};

// Adapter mà mỗi entity phải cung cấp cho engine:
type FetchPage = (params: {
  search: string;
  pageIndex: number;
  pageSize: number;
}) => Promise<Page>;

// Tuỳ chọn nhưng nên có: resolve 1 option theo id, dùng khi form Edit đã có
// sẵn value nhưng item đó chưa từng nằm trong trang dữ liệu đã tải.
type FetchOne = (id: string) => Promise<Option | null>;
```

Mọi entity — dù là "kho", "SKU", "LPN", "đơn hàng" hay bất kỳ object nào ở
project khác — đều phải quy về được 2 hàm này. Nếu entity có thêm filter phụ
(ví dụ lọc theo trạng thái, theo kho cha), filter đó được đóng gói **bên
trong** closure của `fetchPage` ở Lớp 3, engine không cần biết.

## 4. Hành vi bắt buộc của engine (Lớp 1)

1. **Debounce ô tìm kiếm** (~300ms) trước khi gọi `fetchPage` — tránh gọi
   API theo từng keystroke.
2. **Lazy fetch**: chỉ gọi API khi dropdown thực sự mở (hoặc khi có yêu cầu
   auto-fill), không fetch ngay khi component mount nếu người dùng chưa
   tương tác.
3. **Infinite scroll**: khi cuộn gần cuối danh sách đang hiển thị và còn
   `hasNext`, tự động load trang tiếp theo, nối vào danh sách hiện có.
4. **Cache nhãn theo id** (label cache): mọi option đã từng thấy (qua
   `fetchPage` hoặc `fetchOne`) được nhớ lại trong một map `id -> Option`
   tồn tại suốt vòng đời component, để:
   - Khi search filter làm option đã chọn biến mất khỏi danh sách hiện tại,
     trigger vẫn hiển thị đúng nhãn đã chọn (không hiển thị rỗng/id thô).
5. **Resolve giá trị preset**: nếu select có `value` sẵn (form Edit) mà giá
   trị đó chưa có trong cache, gọi `fetchOne(value)` một lần để lấy nhãn,
   hiển thị loading nhỏ trong lúc chờ. Bỏ qua bước này nếu đã có trong cache
   (tránh gọi API thừa).
6. **Trạng thái hiển thị**: loading (đang tải trang đầu), loading thêm
   (đang tải trang kế), rỗng (không có kết quả), có nút xoá lựa chọn (tuỳ
   chọn, dùng cho filter — không dùng cho field bắt buộc trong form).
7. **Không tự chọn giá trị mặc định trừ khi được yêu cầu tường minh** (ví dụ
   một cờ `autoFill`) — hành vi mặc định là để trống cho tới khi người dùng
   chọn.
8. **Điểm mở rộng hiển thị**: cho phép truyền vào cách render 1 option tuỳ
   ý (không ép cứng "name (code)"), và tuỳ chọn hiển thị thêm chi tiết
   (tooltip/info) từ chính bản ghi gốc (`data`) mà không cần entity định
   nghĩa lại toàn bộ danh sách.

## 5. Cache key / query key — quy ước cho filter phụ thuộc

Khi select có filter phụ thuộc ngữ cảnh (ví dụ: LPN chỉ hiển thị theo
`warehouseId` + `status`; kho chỉ hiển thị theo `siteId`), **mọi tham số ảnh
hưởng tới tập kết quả phải nằm trong cache key**, kèm theo chuỗi tìm kiếm đã
debounce:

```
[entityName, "select", debouncedSearch]                 // trường hợp đơn giản
[entityName + ":" + filterA + ":" + filterB, "select", debouncedSearch]
```

Lý do: nếu key thiếu một filter, chuyển filter (ví dụ đổi kho) mà không đổi
key sẽ khiến UI hiển thị cache cũ (sai ngữ cảnh) hoặc không refetch. Khi một
filter phụ đổi mà giá trị đang chọn không còn hợp lệ trong ngữ cảnh mới
(ví dụ đổi site làm giá trị warehouse cũ không còn thuộc site), chủ động
`onChange("")` để tránh giữ một giá trị "mồ côi".

## 6. Quy ước đặt tên (áp dụng ý tưởng, tên cụ thể tuỳ project)

- `<Entity>Select` — bản không gắn form, dùng `value`/`onChange` trực tiếp
  (điển hình: thanh filter trên trang danh sách).
- `<Entity>SelectField` — bản gắn với form library (label, required, lỗi
  validation), dùng trong form thêm/sửa.
- Cả hai đều là **hàm mỏng** bọc quanh engine Lớp 1/2, chỉ truyền
  `fetchPage`/`fetchOne`/cách map field/`renderOption`/`renderInfo` của
  đúng entity đó — không chứa lại UI dropdown.

## 7. Checklist thêm một select mới cho entity X

1. Viết `xFetch(params)`: gọi API list của X, map từng bản ghi thô sang
   `Option { value, name, code, data }`.
2. Viết `xFetchOne(id)`: gọi API get-by-id của X, map sang cùng `Option`.
3. (Tuỳ chọn) Viết `XOption` — cách hiển thị 1 dòng option tuỳ biến nếu
   "name (code)" mặc định không đủ diễn đạt (ví dụ cần thêm badge trạng
   thái).
4. (Tuỳ chọn) Viết `XInfo` — nội dung tooltip liệt kê chi tiết bản ghi khi
   người dùng cần xem thêm mà không phóng to trigger.
5. Xuất `XSelect` và `XSelectField` bằng cách gọi Lớp 1/Lớp 2 với các hàm ở
   bước 1–4, đặt `queryKey` bao gồm mọi filter phụ thuộc (xem mục 5).
6. Không đụng vào file của Lớp 1/Lớp 2.

## 8. Điều cần tránh

- Không viết một component select riêng, tự quản lý debounce/pagination/
  cache cho từng entity — đó là dấu hiệu Lớp 1 đang bị bỏ qua.
- Không tải toàn bộ danh sách về client rồi filter bằng JS khi nguồn dữ
  liệu có thể lớn/không giới hạn — search phải đẩy xuống server.
- Không quên `fetchOne`/cơ chế tương đương khi select có thể nhận `value`
  preset (form Edit) — nếu không, trigger sẽ hiển thị id thô hoặc rỗng.
- Không để filter phụ thuộc nằm ngoài cache key.
- Không nhúng logic riêng của một entity (ví dụ enum trạng thái, luật
  nghiệp vụ) vào engine Lớp 1 — mọi thứ riêng biệt thuộc về Lớp 3.

## 9. Tham chiếu triển khai thực tế trong repo này

Ý tưởng trên được hiện thực bằng React + TanStack Query + shadcn/ui tại
`src/components/selects`:

- Lớp 1: [EntitySelect.tsx](../../src/components/selects/EntitySelect.tsx)
- Lớp 2: [EntitySelectField.tsx](../../src/components/selects/EntitySelectField.tsx)
- Lớp 3 (ví dụ Warehouse, Sku, Lpn, Category, TransactionOrder): [fields.tsx](../../src/components/selects/fields.tsx)

Khi cần ví dụ code cụ thể, đọc các file trên; tài liệu này chỉ mô tả ý
tưởng để áp dụng sang stack/project khác.
