-- Q2: 5-minute POST/request-rate outlier (AD-04)
--
-- Buckets each client_ip's requests into fixed 5-minute (300s) windows, counts
-- total requests and POSTs per bucket, and flags a client_ip when its PEAK
-- 5-min bucket exceeds the POST-rate threshold {posts_per_5min} OR the total
-- request-rate threshold {requests_per_5min}. Catches flooding / fuzzing.
-- Every flagged row carries BOTH identifiers (client_ip + distinct user_agent(s)).
--
-- Parameterized Athena (Trino/Presto) template. The abuse-detector Lambda
-- (Plan 04) does a LITERAL string replace of the placeholder tokens below with
-- numeric/identifier values from site.hcl thresholds. NO request-log field is
-- ever interpolated into this text — attacker-controlled UA/URL/verb strings
-- only ever appear as DATA in result columns, never as SQL.
--
-- Placeholders (the closed substitution set — see queries.test.mjs):
--   {database}          Glue database name
--   {table}             Glue table name (alb_access_logs)
--   {lookback_hours}    recent-window size in hours (cost/partition-prune bound)
--   {posts_per_5min}    peak POST-per-5min threshold (flag when peak >)
--   {requests_per_5min} peak request-per-5min threshold (flag when peak >)
--
-- Columns referenced are exactly those declared by Plan 01's Glue table:
--   client_ip, user_agent, request_verb, request_url, elb_status_code, time,
--   and the projected partition column `day` (format yyyy/MM/dd).

WITH windowed AS (
    SELECT
        client_ip,
        user_agent,
        request_verb,
        request_url,
        elb_status_code,
        from_iso8601_timestamp(time) AS event_time
    FROM "{database}"."{table}"
    -- Partition prune first (cheap), then filter to the exact instant window.
    WHERE day >= date_format(date_add('hour', -{lookback_hours}, now()), '%Y/%m/%d')
      AND from_iso8601_timestamp(time) >= now() - interval '{lookback_hours}' hour
),
bucketed AS (
    SELECT
        client_ip,
        user_agent,
        request_verb,
        request_url,
        elb_status_code,
        -- Floor the event instant to a fixed 5-minute (300s) boundary.
        from_unixtime(floor(to_unixtime(event_time) / 300) * 300) AS bucket_start
    FROM windowed
),
per_bucket AS (
    SELECT
        client_ip,
        bucket_start,
        count(*)                                    AS requests_in_bucket,
        count_if(upper(request_verb) = 'POST')      AS posts_in_bucket
    FROM bucketed
    GROUP BY client_ip, bucket_start
),
peaks AS (
    SELECT
        client_ip,
        max(requests_in_bucket)                     AS peak_requests_5min,
        max(posts_in_bucket)                        AS peak_posts_5min,
        max_by(bucket_start, requests_in_bucket)    AS peak_5min_bucket
    FROM per_bucket
    GROUP BY client_ip
)
SELECT
    b.client_ip,
    array_agg(DISTINCT b.user_agent)                    AS user_agents,
    histogram(b.request_verb)                           AS method_mix,
    pk.peak_5min_bucket,
    pk.peak_requests_5min,
    pk.peak_posts_5min,
    approx_most_frequent(10, b.request_url, 1000)       AS top_paths,
    count_if(b.elb_status_code BETWEEN 400 AND 499)     AS status_4xx,
    count_if(b.elb_status_code BETWEEN 500 AND 599)     AS status_5xx,
    CAST(count_if(b.elb_status_code BETWEEN 400 AND 599) AS double)
        / nullif(count(*), 0)                           AS error_ratio
FROM bucketed b
JOIN peaks pk ON b.client_ip = pk.client_ip
-- Flag when the peak 5-min bucket breaches EITHER the POST or request rate.
WHERE pk.peak_posts_5min > {posts_per_5min}
   OR pk.peak_requests_5min > {requests_per_5min}
GROUP BY
    b.client_ip,
    pk.peak_5min_bucket,
    pk.peak_requests_5min,
    pk.peak_posts_5min
ORDER BY greatest(pk.peak_posts_5min, pk.peak_requests_5min) DESC
