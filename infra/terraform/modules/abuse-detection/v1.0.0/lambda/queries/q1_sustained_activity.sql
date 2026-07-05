-- Q1: Sustained-activity sessionization (AD-03)
--
-- Flags each client_ip whose LONGEST session span >= {session_hours}, where a
-- "session" is a run of requests broken whenever the gap since the previous
-- request from that IP exceeds {session_gap_min} minutes. Every flagged row
-- carries BOTH identifiers (client_ip + the distinct user_agent(s) seen) so the
-- operator can feed a WAF IP-set / Impart rule with an IP and a UA fingerprint.
--
-- Parameterized Athena (Trino/Presto) template. The abuse-detector Lambda
-- (Plan 04) does a LITERAL string replace of the placeholder tokens below with
-- numeric/identifier values sourced from site.hcl thresholds. NO request-log
-- field is ever interpolated into this text — attacker-controlled UA/URL/verb
-- strings only ever appear as DATA in result columns, never as SQL.
--
-- Placeholders (the closed substitution set — see queries.test.mjs):
--   {database}         Glue database name
--   {table}            Glue table name (alb_access_logs)
--   {lookback_hours}   recent-window size in hours (cost/partition-prune bound)
--   {session_gap_min}  gap in minutes that ends a session
--   {session_hours}    max-session-span threshold in hours (flag when >=)
--
-- Columns referenced are exactly those declared by Plan 01's Glue table:
--   client_ip, user_agent, request_verb, request_url, elb_status_code, time,
--   and the projected partition column `day` (format yyyy/MM/dd).

WITH windowed AS (
    SELECT
        client_ip,
        user_agent,
        request_url,
        elb_status_code,
        from_iso8601_timestamp(time) AS event_time
    FROM "{database}"."{table}"
    -- Partition prune first (cheap): keep only day-partitions that can overlap
    -- the lookback window, then filter to the exact instant window (correct).
    WHERE day >= date_format(date_add('hour', -{lookback_hours}, now()), '%Y/%m/%d')
      AND from_iso8601_timestamp(time) >= now() - interval '{lookback_hours}' hour
),
gapped AS (
    SELECT
        client_ip,
        user_agent,
        request_url,
        elb_status_code,
        event_time,
        CASE
            WHEN date_diff(
                     'minute',
                     lag(event_time) OVER (PARTITION BY client_ip ORDER BY event_time),
                     event_time
                 ) > {session_gap_min}
                THEN 1
            ELSE 0
        END AS is_new_session
    FROM windowed
),
sessioned AS (
    SELECT
        client_ip,
        user_agent,
        request_url,
        elb_status_code,
        event_time,
        sum(is_new_session) OVER (
            PARTITION BY client_ip
            ORDER BY event_time
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS session_id
    FROM gapped
),
session_spans AS (
    SELECT
        client_ip,
        session_id,
        date_diff('minute', min(event_time), max(event_time)) AS session_minutes
    FROM sessioned
    GROUP BY client_ip, session_id
),
per_ip AS (
    SELECT
        client_ip,
        max(session_minutes) AS max_session_minutes
    FROM session_spans
    GROUP BY client_ip
)
SELECT
    s.client_ip,
    array_agg(DISTINCT s.user_agent)                        AS user_agents,
    count(*)                                                AS request_count,
    min(s.event_time)                                       AS first_seen,
    max(s.event_time)                                       AS last_seen,
    p.max_session_minutes,
    approx_most_frequent(10, s.request_url, 1000)           AS top_paths,
    count_if(s.elb_status_code BETWEEN 200 AND 299)         AS status_2xx,
    count_if(s.elb_status_code BETWEEN 400 AND 499)         AS status_4xx,
    count_if(s.elb_status_code BETWEEN 500 AND 599)         AS status_5xx
FROM sessioned s
JOIN per_ip p ON s.client_ip = p.client_ip
-- Flag when the longest session span reaches the threshold (hours -> minutes).
WHERE p.max_session_minutes >= {session_hours} * 60
GROUP BY s.client_ip, p.max_session_minutes
ORDER BY p.max_session_minutes DESC
