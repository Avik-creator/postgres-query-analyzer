export interface SampleQuery {
  label: string
  description: string
  sql: string
}

export const SAMPLE_QUERIES: SampleQuery[] = [
  {
    label: "Sequential scan (unindexed filter)",
    description: "Filters orders by status — no index exists, forcing a full scan.",
    sql: `SELECT id, customer_id, total, created_at
FROM demo.orders
WHERE status = 'refunded'
ORDER BY created_at DESC
LIMIT 50;`,
  },
  {
    label: "Hash join across tables",
    description: "Joins orders to customers and aggregates revenue by country.",
    sql: `SELECT c.country, count(*) AS orders, sum(o.total) AS revenue
FROM demo.orders o
JOIN demo.customers c ON c.id = o.customer_id
WHERE o.status = 'paid'
GROUP BY c.country
ORDER BY revenue DESC;`,
  },
  {
    label: "Multi-join with order items",
    description: "Three-way join to compute top selling product categories.",
    sql: `SELECT p.category, sum(oi.quantity) AS units, sum(oi.quantity * oi.unit_price) AS sales
FROM demo.order_items oi
JOIN demo.products p ON p.id = oi.product_id
JOIN demo.orders o ON o.id = oi.order_id
WHERE o.status IN ('paid','shipped','delivered')
GROUP BY p.category
ORDER BY sales DESC;`,
  },
  {
    label: "Expensive sort",
    description: "Sorts a large table by a non-indexed column.",
    sql: `SELECT id, name, lifetime_value
FROM demo.customers
ORDER BY lifetime_value DESC
LIMIT 100;`,
  },
  {
    label: "Correlated lookup",
    description: "Finds recent high-value orders for US customers.",
    sql: `SELECT o.id, o.total, c.name, c.email
FROM demo.orders o
JOIN demo.customers c ON c.id = o.customer_id
WHERE c.country = 'US'
  AND o.total > 800
ORDER BY o.created_at DESC
LIMIT 25;`,
  },
]
