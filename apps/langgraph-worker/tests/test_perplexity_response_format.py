"""Tests for Perplexity JSON completion request format."""

from app.utils.people_discovery import (
    _build_perplexity_response_format,
    PERPLEXITY_PEOPLE_SCHEMA,
    PERPLEXITY_VALIDATION_SCHEMA,
)


def test_perplexity_response_format_uses_json_schema_not_json_object():
    fmt = _build_perplexity_response_format("people_discovery", PERPLEXITY_PEOPLE_SCHEMA)

    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["name"] == "people_discovery"
    assert fmt["json_schema"]["schema"] == PERPLEXITY_PEOPLE_SCHEMA
    assert fmt["type"] != "json_object"


def test_validation_schema_requires_validations_array():
    schema = PERPLEXITY_VALIDATION_SCHEMA
    assert "validations" in schema["properties"]
    assert schema["required"] == ["validations"]
    items = schema["properties"]["validations"]["items"]
    assert "confirmed" in items["properties"]
    assert items["additionalProperties"] is False


def test_people_schema_requires_people_array():
    schema = PERPLEXITY_PEOPLE_SCHEMA
    assert "people" in schema["properties"]
    assert schema["additionalProperties"] is False
