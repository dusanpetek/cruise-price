#!/usr/bin/env python3

import json
import yaml
import sys

MODEL_ORDER = [
    "haiku",
    "sonnet",
    "opus"
]


def load_config():
    with open(".claude/routing.yaml", "r") as f:
        return yaml.safe_load(f)


def cap_model(model, maximum):
    return (
        maximum
        if MODEL_ORDER.index(model) > MODEL_ORDER.index(maximum)
        else model
    )


def classify(prompt, config):

    text = prompt.lower()

    for keyword in config["keywords"]["opus"]:
        if keyword.lower() in text:
            return "opus"

    for keyword in config["keywords"]["sonnet"]:
        if keyword.lower() in text:
            return "sonnet"

    if len(prompt) > 5000:
        return "sonnet"

    return config.get("defaultModel", "haiku")


def main():

    payload = json.load(sys.stdin)

    prompt = payload.get("prompt", "")

    config = load_config()

    selected = classify(prompt, config)

    effective = cap_model(
        selected,
        config["maximumModel"]
    )

    result = {
        "session_state": {
            "selected_model": effective
        }
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
