"""Count how often each word appears in a line of text."""

from collections import Counter


def word_frequency(text: str) -> Counter:
    words = [word.strip(".,!?;:").lower() for word in text.split()]
    return Counter(word for word in words if word)


sentence = input("Enter a sentence: ")
counts = word_frequency(sentence)

print(f"\n{'Word':<12}{'Count':>6}")
print("-" * 18)
for word, count in counts.most_common():
    print(f"{word:<12}{count:>6}")

print(f"\n{len(counts)} distinct words, {sum(counts.values())} total.")
