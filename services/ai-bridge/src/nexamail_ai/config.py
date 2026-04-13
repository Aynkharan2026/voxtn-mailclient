import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    internal_service_token: str
    voxtn_platform_api_url: str
    voxtn_platform_api_key: str
    database_url: str
    sarvam_api_key: str
    gemini_api_key: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            internal_service_token=os.environ.get("INTERNAL_SERVICE_TOKEN", ""),
            voxtn_platform_api_url=os.environ.get(
                "VOXTN_PLATFORM_API_URL", "http://host.docker.internal:8011"
            ),
            voxtn_platform_api_key=os.environ.get("VOXTN_PLATFORM_API_KEY", ""),
            database_url=os.environ.get("DATABASE_URL", ""),
            sarvam_api_key=os.environ.get("SARVAM_API_KEY", ""),
            gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        )


settings = Settings.from_env()
