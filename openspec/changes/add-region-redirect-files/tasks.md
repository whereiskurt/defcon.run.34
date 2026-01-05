## 1. Implementation

- [ ] 1.1 Create `apps/run.human/redirects/` directory
- [ ] 1.2 Create `apps/run.human/redirects/region.html` template with `{{REGION}}` placeholder
- [ ] 1.3 Modify `apps/build.sh` to generate region-specific redirect file from template
- [ ] 1.4 Modify `apps/build.sh` to upload redirect file to S3 as `${REGION_SHORT}` object key

## 2. Validation

- [ ] 2.1 Run `apps/build.sh webapp run.human` and verify redirect file upload
- [ ] 2.2 Test `https://run.defcon.run/use1` redirects to `https://run.defcon.run/use1/`
- [ ] 2.3 Test post-logout flow from Strapi CMS lands correctly on run.defcon.run
