# Change: Add Region Redirect Files for Post-Logout

## Why

After OIDC logout, users are redirected to `https://run.defcon.run/use1` (without trailing slash). CloudFront routes this to S3, but S3 treats `/use1` as a file request rather than a directory. Without a trailing slash, S3 doesn't serve the index document, causing a 403/404 error instead of routing to the ALB.

The auth server's `post_logout_redirect_uris` are configured without trailing slashes (`/use1`, `/cac1`), and changing them would require coordinated updates across multiple services. A simpler fix is to handle this at the S3 level.

## What Changes

- Add templated redirect HTML files at `apps/run.human/redirects/region.html` and `apps/run.auth/redirects/region.html`
- Modify `apps/build.sh` to upload these files to S3 as object key `${REGION_SHORT}` (without trailing slash)
- The redirect files will issue a meta-refresh redirect from `/use1` to `/use1/`

This ensures that when CloudFront/S3 receives `/use1`, it serves the redirect HTML which sends the user to `/use1/` (with trailing slash), which then routes correctly to the ALB.

## Impact

- Affected specs: `static-routing` (new capability)
- Affected code: `apps/run.human/redirects/region.html` (new), `apps/run.auth/redirects/region.html` (new), `apps/build.sh` (modified)
- No auth code changes required
- Works for all regions (use1, cac1)
- Applies to both run.defcon.run and auth.defcon.run
