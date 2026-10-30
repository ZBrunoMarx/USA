# Supabase public certificate authority

`supabase-prod-ca-2021.crt` is a public trust anchor, not a secret or private key. Database deployment sets `sslmode=verify-full` and `sslrootcert` to this file, preserving certificate and hostname verification. No TLS verification bypass is used.

Downloaded over verified HTTPS from the provider distribution:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Supabase documents this CA and the need to install it for verify-full:
https://supabase.com/docs/guides/platform/ssl-enforcement
https://supabase.com/docs/guides/database/connecting-to-postgres

Subject/issuer: Supabase Inc / Supabase Root 2021 CA.
Valid through 2031-04-26.
SHA256 certificate fingerprint: 807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA.

Certificate rotation requires a reviewed replacement from the provider. Existing runtime HTTPS proxy trust settings are preserved. This file is included in the source/backend package and never in the static browser artifact.
