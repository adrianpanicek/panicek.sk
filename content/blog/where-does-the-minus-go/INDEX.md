---
style: "line-height: 1.2; padding-left: 2em"
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

The first idea is pretty straightforward. Let's reserve the leftmost bit for the sign: 0 for plus, 1 for minus. The remaining bits will tell us the absolute value.

```
0101 -> +5
1101 -> -5
```

This solution is called **sign-magnitude**. It works, but look what happens with zero:

```
0000 -> +0
1000 -> -0
```

Two ways to write zero. This wastes one perfectly good value on negative zero. Let's try another technique. We call all numbers carrying a sign **signed** and all numbers not carrying a sign **unsigned**.

## Make the leftmost value negative

Remember our place values?

```
8 4 2 1
```

Let's change just one thing:

```
-8  4  2  1
```

Now the leftmost bit is negative. Everything else works as before: sum the values wherever there's a 1.

```
 1  0  1  1
-8  4  2  1

-8 + 2 + 1 = -5
```

So `1011` represents -5. This technique is called **two's complement**, the usual representation for signed integers on modern computers. Let's check the ends of our new range:

```
0111 ->      4 + 2 + 1 =  7
1000 -> -8             = -8
1111 -> -8 + 4 + 2 + 1 = -1
0000 ->                =  0
```

We still have 16 combinations with 4 bits. But we changed the range to run from -8 to 7 and, at the same time, solved the issue of having two zeros.

## Summary

The bits themselves don't tell us whether a number is signed or unsigned. `1011` can mean 11 as an unsigned number or -5 as a four-bit signed number (in the case of two's complement). Therefore, we need to somehow mark what kind of number is represented within the bits.

And voilà, we found somewhere to put the minus without adding a new symbol.
