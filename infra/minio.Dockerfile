FROM golang:1.25-alpine AS build
RUN apk add --no-cache git ca-certificates
RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10001 minio && adduser -D -u 10001 -G minio minio && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
