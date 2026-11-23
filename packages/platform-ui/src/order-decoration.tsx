import { Box, Stack, Typography } from "@mui/material";
import type { PropsWithChildren, ReactNode } from "react";

import { blackOrder } from "./black-order.ts";

const iconPaths = {
  quill: "M20 3c-5-1-11 4-11 9l-5 5 3 3 5-5c5 0 10-6 8-12ZM7 17l7-7M4 20l-1 1",
  shield: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6Z",
  overview: "M15 9 9 11l-2 6 6-2 2-6ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  request: "M12 5v15M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Z",
  queue: "M9 5h12M9 12h12M9 19h12M3 4h1v2H2M2 11h2v2H2M2 18h2v2H2",
  project: "M8 3h12v14H8ZM4 7H2v14h12v-2",
  help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  spark:
    "m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3ZM5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8L5 16ZM20 2v4m-2-2h4",
} as const;
export function OrderIcon({
  kind = "quill",
  size = 18,
}: Readonly<{ kind?: keyof typeof iconPaths; size?: number }>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d={iconPaths[kind]} />
    </svg>
  );
}

/** Decorative only: never represents a signed verdict or a granted permission. */
export function OrderSigil({ size = 91 }: Readonly<{ size?: number }>) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        position: "relative",
        display: "grid",
        placeItems: "center",
        border: "1px solid #a88d6577",
        borderRadius: "50%",
        color: "#d9bc91",
        boxShadow: "0 0 30px #a0444422",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 9,
          border: "1px solid #ad917680",
          transform: "rotate(45deg)",
        },
        "&::after": {
          content: '""',
          position: "absolute",
          inset: 17,
          border: "1px solid #ad917680",
          borderRadius: "50%",
        },
      }}
    >
      <OrderIcon kind="spark" size={24} />
    </Box>
  );
}

export function OrderSeal() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 41,
        height: 41,
        flexShrink: 0,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        color: "#e5c2a7",
        background: "radial-gradient(circle at 32% 25%, #9c505a, #59232d)",
        boxShadow: "0 2px 5px #0008, inset 0 0 0 3px #642733, inset 0 0 0 4px #c3988377",
      }}
    >
      <OrderIcon />
    </Box>
  );
}

export function OrderOracle({
  children,
  action,
}: PropsWithChildren<{ readonly action?: ReactNode }>) {
  return (
    <Box
      component="section"
      aria-label="Hermes · Хранитель знаний"
      sx={{
        position: "relative",
        minWidth: 0,
        border: "1px solid #75634f",
        borderRadius: "50% 50% 0 0 / 34% 34% 0 0",
        p: "31px 19px 22px",
        background: blackOrder.oracleBackground,
        boxShadow: "inset 0 0 0 5px #151216, inset 0 0 0 6px #66503c88",
        "@media (max-width: 899px)": { borderRadius: 0, p: 3 },
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          mb: "18px",
          "@media (max-width: 899px)": { display: "none" },
        }}
      >
        <OrderSigil />
      </Box>
      <Typography
        component="h2"
        sx={{
          textAlign: "center",
          fontFamily: blackOrder.headingFont,
          fontSize: 29,
          fontWeight: 500,
          letterSpacing: 2,
          color: blackOrder.headingAccent,
        }}
      >
        Hermes
      </Typography>
      <Typography
        sx={{ textAlign: "center", fontSize: 11, color: blackOrder.navMuted, mb: "20px" }}
      >
        Хранитель знаний
      </Typography>
      <Box sx={{ color: "#d8ccbb", "& p": { fontSize: 12, lineHeight: 1.7 } }}>{children}</Box>
      {action && (
        <Box
          sx={{
            mt: "15px",
            "& .MuiButton-root": {
              width: "100%",
              border: "1px solid #846c56",
              backgroundColor: "#b99b7610",
              color: blackOrder.navText,
              fontSize: 11,
              minHeight: 35,
              px: 0.75,
            },
          }}
        >
          {action}
        </Box>
      )}
    </Box>
  );
}

export function OrderHeading({
  children,
  eyebrow = "Архив ордена",
  action,
}: PropsWithChildren<{ readonly eyebrow?: string; readonly action?: ReactNode }>) {
  return (
    <Box
      sx={{
        position: "relative",
        py: "20px",
        pb: "29px",
        minHeight: 165,
        borderBottom: "1px solid #49403b",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "18px",
        flexWrap: { xs: "wrap", sm: "nowrap" },
        "&::after": {
          content: '""',
          position: "absolute",
          bottom: -3,
          left: 0,
          width: 5,
          height: 5,
          bgcolor: "#bfab85",
          transform: "rotate(45deg)",
        },
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: "10px",
          position: "absolute",
          width: { xs: 140, sm: 226 },
          height: 164,
          right: { xs: 0, sm: 28 },
          bottom: 0,
          opacity: { xs: 0.23, md: 0.36 },
          pointerEvents: "none",
        }}
      >
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              height: index === 1 ? 157 : 111,
              width: { xs: index === 1 ? 44 : 37, sm: index === 1 ? 68 : 57 },
              border: "1px solid #8e7a69",
              borderBottom: 0,
              borderRadius: "50% 50% 0 0 / 44% 44% 0 0",
              boxShadow: "inset 0 0 0 5px #211a20, inset 0 0 0 6px #76635455",
              background: "linear-gradient(180deg, #926e6622, transparent)",
            }}
          />
        ))}
      </Box>
      <Stack spacing={1} sx={{ position: "relative", minWidth: 0 }}>
        <Typography
          component="p"
          variant="overline"
          sx={{ color: "#c8b590", letterSpacing: "3px", lineHeight: 1.5 }}
        >
          {eyebrow}
        </Typography>
        {children}
      </Stack>
      {action && <Box sx={{ position: "relative", flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
