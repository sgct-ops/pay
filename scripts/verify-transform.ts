/**
 * Checks the Return Prime transform against a fixture that carries every case
 * the real exports throw at it: multi-line orders, notes that mean "no payout",
 * customer emails that must not be mistaken for UPI handles, already-refunded
 * lines, the wrong refund mode, a stage outside the selected set, two different
 * handles on one order, and a cancelled shipment that still wants paying.
 *
 * Run: npx tsc --noEmit is not enough — this executes the logic.
 *      npm test
 */
import { parseDelimited } from "../src/lib/sheet/parse";
import { findUpis, groupByWeek, transform } from "../src/lib/sheet/transform";

const HEADER = [
  "order_number",
  "serial_number",
  "customer_name",
  "customer_phone",
  "customer_email",
  "item_name",
  "sku",
  "item_quantity",
  "reason",
  "status",
  "shipment_tracking_status",
  "approved_at",
  "received_at",
  "requested_refund_mode",
  "refund_status",
  "eligible_refund_amount",
  "return_fee",
  "upi",
  "refund_additional_details",
].join(",");

const ROWS = [
  // Two payable lines on one order — must combine to 2625.00, one row, 2 pieces.
  `42117,1,Ananya Rao,9810011111,ananya@gmail.com,Linen Shirt,LS-01,1,Size issue,received,Returned to warehouse,"Mon August 17th 2026, 10:12 am","Wed August 19th 2026, 4:00 pm",others,pending,1500.00,0,,"Direct to his UPI 9876543210@ybl"`,
  `42117,2,Ananya Rao,9810011111,ananya@gmail.com,Cotton Trouser,CT-09,1,Size issue,received,Returned to warehouse,"Mon August 17th 2026, 10:12 am","Wed August 19th 2026, 4:00 pm",others,pending,1125.00,0,,"Direct to his UPI 9876543210@ybl"`,

  // One payable, one adjusted elsewhere — the adjusted line must not be summed.
  `42118,1,Rahul Verma,9810022222,rahul@yahoo.in,Denim Jacket,DJ-02,1,Defective,approved,Out for pickup,"Tue August 18th 2026, 9:00 am",,others,pending,999.00,49,,"rahul.verma@okaxis"`,
  `42118,2,Rahul Verma,9810022222,rahul@yahoo.in,Scarf,SC-11,1,Not needed,approved,Out for pickup,"Tue August 18th 2026, 9:00 am",,others,pending,500.00,0,,"Amount adjusted in another product"`,

  // Already refunded — must be dropped entirely.
  `42119,1,Meera Nair,9810033333,meera@gmail.com,Kurta,KU-04,1,Colour,received,Returned to warehouse,"Mon August 17th 2026, 11:00 am",,others,refunded,850.00,0,,"meera@okicici"`,

  // Refund mode is not "others" — not our bucket.
  `42120,1,Sunil Das,9810044444,sunil@gmail.com,Belt,BE-07,1,Size,received,Returned to warehouse,"Mon August 17th 2026, 2:00 pm",,original,pending,600.00,0,,"refund to source"`,

  // Stage outside the default set.
  `42121,1,Priya Shah,9810055555,priya@gmail.com,Dress,DR-03,1,Fit,requested,Requested,"Tue August 25th 2026, 1:00 pm",,others,pending,1400.00,0,,"priya@okhdfcbank"`,

  // Only an email in the notes — must NOT be read as a UPI handle.
  `42122,1,Vikram Iyer,9810066666,vikram@gmail.com,Shirt,SH-08,1,Quality,received,Returned to warehouse,"Tue August 25th 2026, 3:30 pm",,others,pending,700.00,0,,"need upi details, wrote to vikram@gmail.com"`,

  // Cancelled shipment but still carrying a handle — must surface, flagged.
  `42123,1,Neha Gupta,9810077777,neha@gmail.com,Top,TP-12,1,Late,approved,Cancelled,"Wed August 26th 2026, 8:00 am",,others,pending,450.00,0,,"neha@ybl"`,

  // Two different handles on one order — must be flagged as a clash.
  `42124,1,Arjun Mehta,9810088888,arjun@gmail.com,Jeans,JN-05,1,Size,received,Returned to warehouse,"Wed August 26th 2026, 10:00 am",,others,pending,700.00,0,,"arjun@okhdfcbank"`,
  `42124,2,Arjun Mehta,9810088888,arjun@gmail.com,Tee,TE-06,1,Size,received,Returned to warehouse,"Wed August 26th 2026, 10:00 am",,others,pending,500.00,0,,"pay to arjun.m@paytm instead"`,

  // Exchange — zero payout even though an amount is present.
  `42125,1,Kabir Sen,9810099999,kabir@gmail.com,Hoodie,HD-10,1,Size,received,Returned to warehouse,"Wed August 26th 2026, 11:00 am",,others,pending,1800.00,0,,"EXCHANGED for larger size, kabir@ybl"`,
];

const csv = [HEADER, ...ROWS].join("\n");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}  →  ${JSON.stringify(actual)}${
    ok ? "" : `  (expected ${JSON.stringify(expected)})`
  }`);
}

// The handle extractor on its own, including the cases that bit before.
check("plain handle", findUpis("neha@ybl"), ["neha@ybl"]);
check("handle with dots in the local part", findUpis("rahul.verma@okaxis"), ["rahul.verma@okaxis"]);
check("handle ending a sentence", findUpis("pay to abc@ybl."), ["abc@ybl"]);
check("email is not a handle", findUpis("wrote to vikram@gmail.com"), []);
check("multi-level email is not a handle", findUpis("a@mail.co.in"), []);
check("handle beside an email", findUpis("x@gmail.com but pay 98100@ybl"), ["98100@ybl"]);

const rows = parseDelimited(csv);
check("rows parsed", rows.length, ROWS.length);
check("quoted comma survived", rows[7].refund_additional_details.includes(","), true);

const out = transform(rows);
const byNumber = new Map(out.orders.map((o) => [o.orderNumber, o]));

check("no missing columns", out.missingColumns, []);
check("lines kept", out.summary.linesKept, 9);
check("orders", out.summary.orders, 5);
check("refunded order dropped", byNumber.has("42119"), false);
check("wrong refund mode dropped", byNumber.has("42120"), false);
check("unselected stage dropped", byNumber.has("42121"), false);

check("42117 combines two lines", byNumber.get("42117")!.pieces, 2);
check("42117 total", byNumber.get("42117")!.total, 2625);
check("42117 upi from notes", byNumber.get("42117")!.upi, "9876543210@ybl");

check("42118 excludes the adjusted line", byNumber.get("42118")!.total, 999);
check("42118 counts the exclusion", byNumber.get("42118")!.skipped, 1);
check("42118 exclusion reason", byNumber.get("42118")!.lines[1].excludedFor, "adjusted against another product");

check("42122 email is not a UPI handle", byNumber.get("42122")!.upi, "");
check("42123 cancelled shipment flagged", byNumber.get("42123")!.shipRank, 4);
check("42124 handle clash", byNumber.get("42124")!.upiClash, true);
check("42124 first handle wins", byNumber.get("42124")!.upi, "arjun@okhdfcbank");
// 42125 is nothing but an exchange, so there is no payout to decide about and
// no reason for it to sit in the ledger looking like unfinished work.
check("42125 never reaches the ledger", byNumber.has("42125"), false);
check("42125 is counted as excluded", out.summary.ordersExcluded, 1);

check("orders needing a payout", out.summary.ordersPayable, 5);
check("with a usable handle", out.summary.ordersWithUpi, 4);
check("still needing a handle", out.summary.ordersMissingUpi, 1);
check("total payable", out.summary.totalPayable, 2625 + 999 + 700 + 450 + 1200);

const weeks = groupByWeek(out.orders);
check("two weeks", weeks.length, 2);
check("oldest week first", weeks[0].label, "17 Aug – 23 Aug 2026");
check("second week", weeks[1].label, "24 Aug – 30 Aug 2026");
check("week one holds the August 17-18 orders", weeks[0].orders.map((o) => o.orderNumber), [
  "42117",
  "42118",
]);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
