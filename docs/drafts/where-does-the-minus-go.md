---
title: Where does the minus go?
date: 2026-09-28
tags:
  - computers
  - education
---

# Where does the minus go?

Last time, we figured out how to represent numbers using only ones and zeros. With four bits, we could count from 0 to 15. Great. But what if it's minus five degrees outside? Where do we put the minus?

On paper, we just write `-101` for negative five in binary. Inside a computer, though, we need a way to encode that sign using bits too.

Let's stick to four bits for now. Small enough to do everything on paper, big enough to get ourselves into trouble.

## Just use one bit for the sign

The first idea is pretty straightforward. Let's reserve the leftmost bit for the sign: 0 for plus, 1 for minus. The remaining three bits tell us the size of the number.

```
0101 -> +5
1101 -> -5
```

This is called **sign-magnitude** representation. It works, but look what happens with zero:

```
0000 -> +0
1000 -> -0
```

Two ways to write zero. A little awkward. And ordinary binary addition doesn't give us the answer we'd expect:

```
  0101    +5
+ 1101    -5
------
 10010
```

If we keep only four bits, we get `0010`, or 2. We wanted zero. We can build arithmetic that handles sign-magnitude correctly, but it needs to account for the sign separately.

Let's try another arrangement.

## Make the leftmost value negative

Remember our place values?

```
8 4 2 1
```

Let's change just one thing:

```
-8  4  2  1
```

Now the leftmost bit contributes **minus eight**. Everything else works as before: add up the values wherever there's a 1.

```
 1  0  1  1
-8  4  2  1

-8 + 2 + 1 = -5
```

So `1011` represents -5. This arrangement is called **two's complement**, the usual representation for signed integers on modern computers. [Cornell's notes](https://www.cs.cornell.edu/courses/cs3410/2026sp/notes/numbers.html) describe both approaches if you'd like to explore further.

Let's check the ends of our new range:

```
0111 ->      4 + 2 + 1 =  7
1000 -> -8             = -8
1111 -> -8 + 4 + 2 + 1 = -1
0000 ->                  0
```

We still have 16 combinations. We've just assigned them to the numbers from -8 to 7 instead of 0 to 15. And there's only one zero now.

## Flip the bits, add one

Adding negative place values is nice when reading a number. But how do we write -5 without trying different combinations?

Start with positive five in four bits. Flip every bit, then add one:

```
0101 ->  5
1010 ->  flip every 0 to 1 and every 1 to 0
1011 ->  add 1
```

There's our -5 again.

Why does this trick work? In four bits, a number and its flipped version add up to `1111`, or 15 when read as unsigned. Adding one makes the total 16. Keeping only four bits leaves zero, so the new pattern acts as the original number's opposite.

Let's actually add them. Binary addition uses carries just like decimal addition, except `1 + 1` is `10`: write 0 and carry 1.

```
  0101     5
+ 1011    -5
------
 10000
```

Keep the rightmost four bits and we get `0000`. Exactly what we wanted.

The same addition also handles a result that isn't zero:

```
  0011     3
+ 1011    -5
------
  1110    -2

-8 + 4 + 2 = -2
```

This is the useful part: the bit-by-bit addition works for both unsigned and two's complement numbers. We just interpret the result differently.

## There's still a limit

Four bits can't hold every answer. Let's try `7 + 1`:

```
  0111     7
+ 0001     1
------
  1000    -8?
```

The correct answer is 8, but our signed range ends at 7. This is **signed overflow**. The resulting four-bit pattern represents -8, so it doesn't represent the mathematical answer.

Notice that there was no fifth bit here. A carry beyond our four bits and signed overflow are different things: `5 + (-5)` produced a carry and a correct answer; `7 + 1` produced no carry beyond four bits and an answer outside our range.

These examples show the stored bit patterns. What a programming language does when signed arithmetic overflows depends on its rules; don't assume every program will simply wrap around.

With eight bits, the signed range is -128 to 127. There's always one extra negative value because zero takes one of the patterns whose sign bit is 0. That also gives our flip-and-add trick one awkward case: in four bits, negating `1000` gives `1000` again. Positive eight simply doesn't fit. The [GNU C manual](https://www.gnu.org/software/c-intro-and-ref/manual/html_node/Integer-Representations.html) walks through these limits too.

## More bits, same number

One last detail. Earlier, we could put zeros in front of an unsigned number without changing its value. For negative two's complement numbers, that would change the meaning:

```
    1011 -> -5 in four bits
00001011 -> 11 in eight bits
```

To widen a signed number, copy its leftmost bit into the new positions. This is called **sign extension**. [Cornell's explanation](https://www.cs.cornell.edu/courses/cs3410/2024fa/notes/asm-mem.html) covers how computers use it when loading values.

```
    1011 -> -5 in four bits
11111011 -> -5 in eight bits

-128 + 64 + 32 + 16 + 8 + 2 + 1 = -5
```

For a positive number, the leftmost bit is 0, so we fill the new positions with zeros instead.

## Summary

The bits don't tell us which interpretation to use. `1011` can mean 11 as an unsigned number or -5 as a four-bit two's complement number. We need to know the representation and the width.

Once we've agreed on those, the trick is fairly small: give the leftmost bit a negative place value, then add up the values as before. To change the sign, flip the bits and add one, keeping an eye on the range.

And voilà, we found somewhere to put the minus without adding a new symbol.
