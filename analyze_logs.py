#!/usr/bin/env python3
"""
Analyze DJ logs to identify failure patterns
"""

import json
import re
from collections import Counter, defaultdict
from pathlib import Path


def analyze_log_file(log_path: str):
    """Parse and analyze the log file for error patterns"""

    print("=" * 80)
    print("DJ LOG ANALYSIS")
    print("=" * 80)

    # Counters
    error_types = Counter()
    validation_errors = defaultdict(lambda: Counter())
    broken_messages = []
    content_events = []

    # Read log file
    with open(log_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract all JSON objects (SSE events)
    # Pattern: data: {"type":"...","data":...}
    sse_pattern = r'data: (\{[^}]+(?:\{[^}]*\})*[^}]*\})'

    for match in re.finditer(sse_pattern, content):
        try:
            event_json = match.group(1)
            event = json.loads(event_json)

            # Count by event type
            event_type = event.get('type', 'unknown')

            # Check for log events with errors
            if event_type == 'log':
                log_data = event.get('data', {})
                level = log_data.get('level')
                message = log_data.get('message', '')

                if level == 'error':
                    error_types[message.split(']')[0] + ']'] += 1

                    # Extract validation error details
                    if 'validation' in str(log_data.get('data', '')):
                        error_data = log_data.get('data', {})
                        if isinstance(error_data, dict):
                            error_str = error_data.get('error', '')
                            if error_str:
                                # Parse Zod validation errors
                                if 'invalid_type' in error_str:
                                    validation_errors['type_mismatches'][message] += 1
                                if 'invalid_string' in error_str:
                                    validation_errors['url_validation'][message] += 1

                # Check for incomplete/broken messages
                if message.endswith('\"') or message.endswith('\\'):
                    broken_messages.append(message)

            # Collect content events
            elif event_type == 'content':
                content_data = event.get('data', '')
                if content_data:
                    content_events.append(content_data)

        except json.JSONDecodeError:
            continue

    # Print findings
    print("\n📊 ERROR SUMMARY")
    print("-" * 80)
    for error_prefix, count in error_types.most_common(20):
        print(f"  {count:4d}x {error_prefix}")

    print("\n🔍 VALIDATION ERROR PATTERNS")
    print("-" * 80)
    if validation_errors['type_mismatches']:
        print("  Type Mismatches (number vs string):")
        for err, count in list(validation_errors['type_mismatches'].items())[:10]:
            print(f"    {count:3d}x {err[:100]}")

    if validation_errors['url_validation']:
        print("\n  URL Validation Errors:")
        for err, count in list(validation_errors['url_validation'].items())[:10]:
            print(f"    {count:3d}x {err[:100]}")

    print("\n💬 BROKEN/INCOMPLETE MESSAGES")
    print("-" * 80)
    if broken_messages:
        print(f"  Found {len(broken_messages)} incomplete log messages")
        for msg in broken_messages[:10]:
            print(f"    • {msg[:100]}")
    else:
        print("  ✅ No obviously broken messages found")

    print("\n📝 CONTENT EVENTS SAMPLE")
    print("-" * 80)
    if content_events:
        print(f"  Total content events: {len(content_events)}")
        print("  First 10 content chunks:")
        for i, chunk in enumerate(content_events[:10], 1):
            clean_chunk = chunk.strip().replace('\n', '\\n')
            print(f"    {i:2d}. {clean_chunk[:80]}")

    print("\n" + "=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)

    # Generate recommendations
    if validation_errors['type_mismatches']:
        print("  1. Fix Last.fm/Deezer schemas to handle string→number coercion")
        print("     • Use z.preprocess() or z.coerce.number() for numeric fields")

    if validation_errors['url_validation']:
        print("  2. Fix URL validation to handle empty strings")
        print("     • Use z.string().url().or(z.literal('')) or make URLs optional")

    if broken_messages:
        print("  3. Fix log message formatting")
        print("     • Ensure all log messages are complete strings")
        print("     • Escape quotes properly in log messages")

    print("\n✨ Analysis complete!\n")


if __name__ == '__main__':
    log_file = Path('dj.current.space-1762206985389.log')
    if not log_file.exists():
        print(f"❌ Log file not found: {log_file}")
        exit(1)

    analyze_log_file(str(log_file))
