# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server/ ./server/
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/chenchen-learning ./server

FROM alpine:3.23
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public
RUN addgroup -g 10001 appuser \
 && adduser -D -u 10001 -G appuser -h /app appuser \
 && mkdir -p /data && chown appuser:appuser /data
COPY --from=build /out/chenchen-learning /app/chenchen-learning
COPY public/ /app/public/
USER 10001:10001
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/app/chenchen-learning", "healthcheck"]

CMD ["/app/chenchen-learning"]
