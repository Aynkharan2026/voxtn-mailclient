import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    internal_service_token: str
    tracking_worker_token: str
    voxtn_platform_api_url: str
    voxtn_platform_api_key: str
    database_url: str
    sarvam_api_key: str
    gemini_api_key: str
    stripe_secret_key: str
    stripe_webhook_secret: str
    stripe_price_starter: str
    stripe_price_pro: str
    app_base_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            internal_service_token=os.environ.get("INTERNAL_SERVICE_TOKEN", ""),
            tracking_worker_token=os.environ.get("TRACKING_WORKER_TOKEN", ""),
            voxtn_platform_api_url=os.environ.get(
                "VOXTN_PLATFORM_API_URL", "http://host.docker.internal:8011"
            ),
            voxtn_platform_api_key=os.environ.get("VOXTN_PLATFORM_API_KEY", ""),
            database_url=os.environ.get("DATABASE_URL", ""),
            sarvam_api_key=os.environ.get("SARVAM_API_KEY", ""),
            gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
            stripe_secret_key=os.environ.get("STRIPE_SECRET_KEY", ""),
            stripe_webhook_secret=os.environ.get("STRIPE_WEBHOOK_SECRET", ""),
            stripe_price_starter=os.environ.get("STRIPE_PRICE_STARTER", ""),
            stripe_price_pro=os.environ.get("STRIPE_PRICE_PRO", ""),
            app_base_url=(
                os.environ.get("APP_BASE_URL", "http://localhost:3000").rstrip("/")
            ),
        )


settings = Settings.from_env()
