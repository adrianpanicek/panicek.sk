---
style: "line-height: 1.2; padding-left: 2em"
title: ALU is not a metal
date: 2026-09-28
tags:
  - computers
  - education
---

# ALU is not a metal

By now, we know how to fill our egg cups to represent numbers. And we found somewhere to put the minus. But what is a computer for if not for computing? Let's look at the basic operations and how a computer processes them.

I'll teach you a new abbreviation. It's one of my favorites, and I'm ashamed to admit it's part of my core vocabulary, used almost daily. It stands for **arithmetic logic unit**, or **ALU**. Don't overthink it; it's just a part of the processor that actually performs operations on numbers. Give it two numbers (or more, because **SIMD** is also one of my favorites) and tell it which operation to perform.

## One plus one is ten

Adding in binary works just like adding on paper in decimal. Start on the right, add the digits, and carry anything that doesn't fit into the next column.

There are only a few cases to remember:

```
0 + 0 = 00
0 + 1 = 01
1 + 0 = 01
1 + 1 = 10
```

Keep in mind that `10` is in binary, meaning `2`~10~. We can't put two girls... I mean, eggs... in one cup, so we leave this cup empty and carry a `1` into the cup on its left. If the result of addition in that column is `1` as well, we just keep on carrying the one over.

Let's try `5` + `3`:

```
  0101   -> 5
+ 0011   -> 3
------
  1000   -> 8
```

Let's keep track of the carry on the side. At the start, we set the **carry** to `0`.

Starting from the right:

1. 1 + 1 + **carry** is binary `10`. Write `0` and set **carry** to `1`.
2. 0 + 1 + **carry** is `10` again. Write `0` and set **carry** to `1`.
3. 1 + 0 + **carry** is also `10`. Write `0` and set **carry** to `1`.
4. 0 + 0 + **carry** is `1`. Write `1` and reset **carry** to `0`.

The resulting number is `1000`, or `8`~10~. We're reading these numbers as **unsigned** for now.

## Subtraction is addition in disguise

For subtraction, two's complement numbers are super useful. We can just use addition after turning the second number into a negative signed number.

```
5 - 3 = 5 + (-3)
```

Here's a handy trick for finding the negative of a number in two's complement: **"flip" every bit, then add one**. "Flipping" means replacing every `0` with `1` and every `1` with `0`.

For example, let's turn 3 into -3:

```
0011  ->  3
1100  ->  "flip" every bit
1101  ->  add one
```

Remember the trick from signed numbers? The number `1101` just means `-8` + `4` + `1` = `-3`. So let's add it to 5.

```
   0101   ->  5
+  1101   -> -3
-------
  10010
```

Notice that we got 5 bits as a result, but we only have 4 bits available. In this case, we can trim the leftmost bit and keep only the 4 relevant bits.

```
0010 -> 2
```

I don't want to leave you without a proper explanation. Remember that `1101` is `-3`, but it is also `13`, depending on the way we interpret the number. But adding `5` and `13` would result in `18` and not `2`.

If we look at the number we got originally:

```
10010 -> 16 + 2 = 18
```

And `18` is exactly what we got. But as you noticed, we got 5 bits instead of the expected 4. To properly do subtraction, we need to keep the resulting number of bits the same as the largest number of bits in any of the input numbers. That's because to do subtraction on unsigned numbers, we rely on **overflow**.

## What if we run out of bits?

Let's add one to the largest unsigned number we can store:

```
   1111   -> 15
+  0001   ->  1
-------
  10000   -> 16
```

The answer needs five bits. If we only keep four, we get `0000`. Our result has wrapped around to zero, like a counter running out of digits. The correct answer is outside the range we can represent. Here, the carry out of the leftmost column tells us that happened.

Signed numbers have a different problem.

```
  0111   ->  7
+ 0001   ->  1
------
  1000   -> -8, if read as signed
```

There is no extra carry bit outside our four bits this time. Yet adding two positive numbers has produced a negative number. The correct answer, `8`, doesn't fit in our signed range of `-8` to `7`. This is called **signed overflow**.

## Working on the bits individually

### AND?

On top of standard arithmetic operations, processors also do a lot of **bitwise operations**. These are simple operations performed bit by bit, using a **logical operator** to produce a result.

This is much easier shown than explained. Let's say we want to get `1` as a result if both inputs are `1`.

```
1 and 1 -> 1
1 and 0 -> 0
0 and 1 -> 0
0 and 0 -> 0
```

This logical operation is called **and** and is normally denoted by an ampersand, `&` (like `1 & 1 -> 1`).

Let's do this on a whole number from left to right:

```
12 & 10 = 8

  1100 -> 12
& 1010 -> 10
  ----
  1000 -> 8
```

Cool and all, but it doesn't seem very useful. But bear with me for a minute.

### OR what?

The other operation is called **or**. Its result is `1` if either the first or the second input is `1`.

```
1 or 1 -> 1
1 or 0 -> 1
0 or 1 -> 1
0 or 0 -> 0
```

Again, the standard notation for this operator is a pipe, `|`.

```
12 | 10 = 14

  1100 -> 12
| 1010 -> 10
  ----
  1110 -> 14
```

### NOT again

Earlier in the article, I wrote "flip" in quotation marks. The reason is that there is a technical word for the operation. And it's **not**.

You read that right; that was the end of the sentence.

The **not** operator will turn every `1` into `0` and every `0` into `1`.

```
not 0 -> 1
not 1 -> 0
```

The symbol for **not** is a tilde, `~`.

And in the case of 4 bits:

```
~ 1110 -> 0001
```

This is also our first example of a **unary operator**, meaning the operator only needs a single input value.

There are many more interesting operations we can do on numbers, but we can catch up later.

## Summary

The ALU gives our bits something to do. This serves as a core idea behind making a flat pancake of sand think. In the future, we might explore more operations, learn how to store and calculate with numbers that have a decimal point, and discover a little bit about how processors are designed.
