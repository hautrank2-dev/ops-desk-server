---
description: Quy ước thiết kế REST API cho tầng server — cách đặt tên query (page, pageSize, populations, sortBy, order, xxxId, xxxIds, startXxxAt/endXxxAt), cách lọc/tìm kiếm/phân trang, hình dạng response danh sách và lỗi. Đọc trước khi thêm/sửa bất kỳ endpoint list, DTO query, hay filter nào.
paths:
  - "src/**"
---

# REST API — đặc tả quy ước (framework-agnostic)

Tài liệu này mô tả **quy ước** đặt tên và hành vi của API, **không phải** code
của một framework cụ thể. Mục tiêu: bất kỳ agent AI nào, ở bất kỳ project nào
(khác ngôn ngữ, khác framework, khác ORM) đọc xong đều dựng lại được một tập
API "list / detail / create / update" nhất quán, dùng chung một bộ tên query
cho mọi entity (ticket, asset, user, đơn hàng, ...) mà không phải bịa lại quy
ước mỗi lần thêm resource mới.

Nguyên tắc gốc: **tên query và hình dạng response là một hợp đồng (contract)**.
Client (web, mobile) dựa vào đúng những cái tên này. Đổi tên tuỳ tiện ở một
endpoint = phá client. Vì vậy mọi endpoint list phải dùng chung bộ tên dưới
đây; entity chỉ được thêm filter riêng, không được đổi tên các tham số chung.

## 1. Phân tầng khái niệm một endpoint list

Một endpoint trả danh sách luôn ghép từ 4 nhóm tham số **độc lập nhau**, không
trộn lẫn:

```
1. Pagination  — page, pageSize           (bao nhiêu, trang nào)
2. Sort        — sortBy, order            (sắp theo gì, chiều nào)
3. Include     — populations              (nạp thêm quan hệ nào)
4. Filter      — theo từng entity         (lọc tập kết quả)
```

Ba nhóm đầu (1–3) là **chung cho mọi entity**, tên cố định. Nhóm 4 là riêng của
từng entity nhưng phải tuân theo quy tắc đặt tên ở mục 5. Tách bạch như vậy để:
một base DTO/schema chung lo pagination + sort + include, mỗi entity chỉ khai
báo thêm phần filter của mình (kế thừa, không copy).

## 2. Pagination — `page`, `pageSize`

- Tên bắt buộc: **`page`** (1-based, mặc định `1`) và **`pageSize`** (mặc định
  `20`). Không dùng `limit/offset`, `perPage`, `size`, `pageIndex` ở lớp API.
- Cả hai là số nguyên `>= 1`.
- **Kẹp giá trị ở server** (clamp), không tin dữ liệu client: `page` tối thiểu
  `1`; `pageSize` kẹp trong khoảng `[1, MAX]` (ví dụ MAX = 200) để một request
  không kéo về cả bảng. Giá trị mặc định trong DTO **không đủ** — vẫn phải kẹp
  lại trong lúc build query vì client có thể gửi `0`, số âm, hoặc quá lớn.
- `skip = (page - 1) * pageSize`.

## 3. Sort — `sortBy`, `order`

- **`sortBy`**: tên field để sắp xếp, mặc định `createdAt`.
- **`order`**: `'asc' | 'desc'`, mặc định `desc`.
- **Whitelist `sortBy` ở server**: chỉ chấp nhận một tập field cho phép (ví dụ
  `createdAt`, `updatedAt`, `code`, `name`, `status`, ...); giá trị lạ → rơi về
  mặc định `createdAt`. Không bao giờ đẩy thẳng `sortBy` từ client vào câu lệnh
  sort của DB (tránh sort theo field không index, hoặc lộ field nội bộ).
- Chỉ hỗ trợ 1 khoá sort là đủ cho hầu hết trường hợp; nếu cần multi-sort thì
  mở rộng `sortBy` thành danh sách nhưng vẫn giữ nguyên tên hai tham số này.

## 4. Include quan hệ — `populations`

- Tên bắt buộc: **`populations`** — danh sách các quan hệ cần nạp kèm (join /
  populate / eager-load), ví dụ `createdBy`, `updatedBy`, `assetId`. Mặc định
  rỗng (không nạp gì) để response nhẹ; client tự chọn thứ cần.
- **Chấp nhận cả hai dạng input, luôn chuẩn hoá về mảng**:
  - lặp tham số: `?populations=createdBy&populations=updatedBy`
  - phẩy ngăn cách: `?populations=createdBy,updatedBy`
- **Whitelist theo enum của từng entity**: mỗi entity định nghĩa tập quan hệ
  hợp lệ của riêng nó (một enum `XxxPopulation`), và validate `populations`
  theo enum đó. Base chỉ định nghĩa hình dạng "mảng string đã trim"; entity
  thu hẹp (narrow) lại danh sách giá trị cho phép. Không cho phép populate một
  quan hệ tuỳ ý client gửi lên.

> Vì sao gọi là `populations` (số nhiều) chứ không phải `include`/`expand`: đây
> là quy ước đã chốt của hệ thống này — giữ nguyên để không phá client. Khi
> port sang project khác có thể đổi tên, nhưng trong cùng hệ thống phải thống
> nhất một tên duy nhất.

## 5. Filter — quy ước đặt tên theo *kiểu* của field

Filter là phần riêng của từng entity, nhưng **cách đặt tên phải suy ra được từ
kiểu dữ liệu**, để client đoán được tên mà không cần đọc từng DTO:

| Loại filter | Quy ước tên | Ngữ nghĩa & cách match |
|---|---|---|
| Tìm text | trùng tên field: `code`, `name`, `title`, `serialNumber` | **partial match, case-insensitive** (contains). Không phải so bằng tuyệt đối. |
| Enum / trạng thái | trùng tên field: `type`, `status`, `priority` | **so bằng chính xác**, validate theo enum. |
| Boolean | trùng tên field: `active`, `isActive` | nhận `true`/`false` (dạng chuỗi trên query) → ép về boolean. |
| Tham chiếu 1 id | **`<field>Id`**: `locationId`, `assigneeId`, `departmentId`, `assetId` | so bằng chính xác theo id. |
| Tham chiếu nhiều id | **`<field>Ids`** (số nhiều): `assetItemIds` | nhận mảng (lặp hoặc phẩy), match "chứa tất cả" hoặc "thuộc tập" tuỳ nghiệp vụ. |
| Khoảng thời gian | **`start<Field>At` / `end<Field>At`**: `startDueAt`/`endDueAt`, `startCreatedAt`/`endCreatedAt` | biên dưới/biên trên, giá trị **ISO datetime**; áp `>= start` và `<= end`. Cho phép chỉ một trong hai biên. |
| Ai tạo | **`createdBy`** (nhận userId) | so bằng theo id người tạo. |

Quy tắc chốt:
- Field text → tìm gần đúng; enum/id → so bằng. Không trộn (đừng để `status`
  thành partial match).
- Một id đơn luôn có hậu tố `Id`; nhiều id luôn có hậu tố `Ids`.
- Mọi khoảng (range) đặt theo cặp `start*/end*` cùng gốc tên; đừng đặt
  `dueFrom/dueTo`, `minDate/maxDate` lẫn lộn giữa các entity.
- **Bỏ qua filter khi giá trị rỗng/không gửi**: chỉ thêm điều kiện vào query khi
  tham số thực sự có giá trị (không thêm mệnh đề với chuỗi rỗng / null /
  undefined).

## 6. Chuẩn hoá & validate input (bắt buộc)

Query string luôn tới dưới dạng **chuỗi** (hoặc mảng chuỗi). Phải chuẩn hoá
trước khi validate:

1. **Ép kiểu**: `page`/`pageSize` → số; `active`/`isActive` → boolean; các field
   "mảng" (`populations`, `*Ids`) → luôn về mảng (dù client gửi 1 phần tử).
2. **Chuẩn hoá mảng**: chấp nhận cả dạng lặp tham số và dạng phẩy; `trim` từng
   phần tử; loại phần tử rỗng.
3. **Whitelist toàn cục**: từ chối tham số query lạ không nằm trong DTO (chống
   client gửi field rác / dò field nội bộ). `sortBy` và `populations` whitelist
   thêm theo tập giá trị cho phép (mục 3, 4).
4. **Validate kiểu**: id đúng định dạng id, enum đúng tập giá trị, ngày đúng ISO.
   Sai → trả 400 với thông điệp rõ ràng.

## 7. Hình dạng response danh sách (list envelope)

Endpoint list **luôn** trả cùng một "phong bì", không trả mảng trần:

```jsonc
{
  "page": 1,          // trang hiện tại (echo lại input)
  "pageSize": 20,     // cỡ trang hiện tại (echo lại input)
  "total": 137,       // tổng số bản ghi khớp filter (đếm không phân trang)
  "totalPage": 7,     // ceil(total / pageSize)
  "items": [ /* ... */ ]  // dữ liệu trang này
}
```

- Tên field cố định: `page`, `pageSize`, `total`, `totalPage`, `items`. Client
  phân trang dựa vào đúng các tên này.
- `total` là **đếm theo filter** (không tính skip/limit), chạy song song với
  truy vấn lấy `items` (đếm + lấy trang cùng lúc rồi gộp).
- Endpoint **detail** (`GET /resource/:id`) trả thẳng object, không bọc phong bì;
  không tìm thấy → 404.

## 8. Quy ước route & method

- **Prefix chung** cho toàn API (ví dụ `/api`). Đặt một chỗ, không lặp trong
  từng route.
- Một resource = một danh từ (số ít hoặc số nhiều, nhưng **thống nhất toàn hệ
  thống**), ví dụ `/ticket`, `/asset`, `/user`.
- Method chuẩn REST:
  - `GET /resource` — list (nhận query ở mục 1–5).
  - `GET /resource/:id` — detail.
  - `POST /resource` — tạo.
  - `PATCH /resource/:id` — cập nhật một phần (ưu tiên `PATCH` hơn `PUT` cho
    update từng phần).
- **Sub-resource** theo quan hệ sở hữu: `GET /resource/:id/items`,
  `POST /resource/:id/images`, `DELETE /resource/:id/images/:index`.
- **Hành động không thuần CRUD** thì đặt route động từ rõ nghĩa dưới id thay vì
  cố nhét vào PATCH: ví dụ `POST /resource/:id/remove-items`,
  `POST /resource/:id/close`. Ưu tiên diễn đạt đúng ý định hơn là ép REST thuần.

## 9. Hình dạng lỗi (error envelope)

Mọi lỗi trả cùng một cấu trúc, để client bắt lỗi thống nhất:

```jsonc
{
  "statusCode": 400,
  "timestamp": "2026-08-01T10:00:00.000Z",
  "path": "/api/ticket",
  "error": "message ngắn gọn",
  "message": [ /* chi tiết validate, nếu có */ ]
}
```

- Dùng đúng HTTP status: `400` input sai, `401/403` auth, `404` không thấy,
  `409` xung đột (ví dụ đụng unique key), `500` lỗi hệ thống.
- Thông điệp lỗi hướng tới client hiểu được (nêu id/field sai), không lộ chi
  tiết nội bộ (stack, câu lệnh DB).

## 10. Checklist thêm một endpoint list cho entity X

1. Kế thừa base pagination + sort + include (đừng khai lại `page`/`pageSize`/
   `sortBy`/`order`/`populations`).
2. Khai báo `XxxPopulation` (enum các quan hệ hợp lệ) và whitelist
   `populations` theo enum đó.
3. Thêm filter riêng theo **đúng quy ước tên ở mục 5** (id → `Id`, nhiều id →
   `Ids`, range → `start*/end*`, text → partial, enum → exact).
4. Trong lúc build query: clamp `page`/`pageSize`, whitelist `sortBy`, chỉ thêm
   mệnh đề cho filter có giá trị.
5. Trả về đúng list envelope ở mục 7 (đếm `total` song song).
6. Không phá tên tham số chung; nếu thấy thiếu một tham số chung mới, thêm vào
   **base** (để mọi entity dùng lại) chứ không nhét riêng cho một entity.

## 11. Điều cần tránh

- Không trả mảng trần cho endpoint list (mất `total`/`totalPage` → client không
  phân trang được).
- Không đặt tên phân trang khác nhau giữa các endpoint (`page/pageSize` chỗ này,
  `limit/offset` chỗ kia).
- Không so bằng tuyệt đối cho field tìm text, và ngược lại đừng partial-match cho
  enum/id.
- Không đẩy `sortBy`/`populations` từ client thẳng vào DB khi chưa whitelist.
- Không bỏ clamp `pageSize` (một request kéo cả bảng là lỗ hổng hiệu năng).
- Không thêm mệnh đề filter cho tham số rỗng (làm sai kết quả và chậm query).
- Không định nghĩa lại quy ước chung trong từng entity — phần chung thuộc về base.

## 12. Tham chiếu triển khai thực tế trong repo này

Quy ước trên đang được hiện thực bằng NestJS + Mongoose:

- Base query (pagination/include): [src/types/query.ts](../../src/types/query.ts)
  (`QueryPagination`, `QueryInclude`, `QueryCommon`).
- Chuẩn hoá mảng query: [src/utils/transform.ts](../../src/utils/transform.ts)
  (`ToArrayQuery`, `ToStringArrayQuery`).
- List envelope: [src/types/response.ts](../../src/types/response.ts)
  (`TableResponse<T>`).
- Ví dụ filter đầy đủ (text/enum/id/ids/range/sort/populations):
  [src/modules/ticket/dto/ticket-query.dto.ts](../../src/modules/ticket/dto/ticket-query.dto.ts)
  và cách build query + clamp + whitelist trong
  [src/modules/ticket/ticket.service.ts](../../src/modules/ticket/ticket.service.ts) (`findAll`).
- Prefix + validate toàn cục (whitelist, transform):
  [src/main.ts](../../src/main.ts).
- Error envelope: [src/config/http-exception.filter.ts](../../src/config/http-exception.filter.ts).

Khi cần ví dụ code cụ thể, đọc các file trên; tài liệu này chỉ mô tả quy ước để
áp dụng sang stack/project/framework khác.
