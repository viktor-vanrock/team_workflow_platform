import { createTheme, CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import type { PropsWithChildren } from "react";

import { blackOrder as order } from "./black-order.ts";

const fontStyles = `
@font-face { font-family: 'Cormorant Garamond'; font-style: normal; font-weight: 500; font-display: swap; src: url('${new URL("./fonts/cormorant-garamond-500.ttf", import.meta.url).href}') format('truetype'); }
@font-face { font-family: Manrope; font-style: normal; font-weight: 400; font-display: swap; src: url('${new URL("./fonts/manrope-400.ttf", import.meta.url).href}') format('truetype'); }
@font-face { font-family: Manrope; font-style: normal; font-weight: 500; font-display: swap; src: url('${new URL("./fonts/manrope-500.ttf", import.meta.url).href}') format('truetype'); }
@font-face { font-family: Manrope; font-style: normal; font-weight: 600; font-display: swap; src: url('${new URL("./fonts/manrope-600.ttf", import.meta.url).href}') format('truetype'); }
`;

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: order.wax, light: order.waxHover, dark: "#662831", contrastText: order.text },
    secondary: { main: order.metal, contrastText: order.canvas },
    background: { default: order.canvas, paper: order.surface },
    text: { primary: order.text, secondary: order.muted, disabled: order.muted },
    divider: order.border,
    success: { main: order.success, contrastText: order.canvas },
    warning: { main: order.warning, contrastText: order.canvas },
    error: { main: order.error, contrastText: order.canvas },
    info: { main: order.info, contrastText: order.canvas },
    action: { active: order.metal, disabled: order.muted, disabledBackground: order.raised },
  },
  typography: {
    fontFamily: order.bodyFont,
    fontSize: 13,
    h1: {
      fontFamily: order.headingFont,
      fontSize: 43,
      fontWeight: 500,
      lineHeight: 1.1,
      letterSpacing: 1,
    },
    h2: { fontFamily: order.headingFont, fontSize: 36, fontWeight: 500, lineHeight: 1.15 },
    h3: {
      fontFamily: order.headingFont,
      fontSize: 43,
      fontWeight: 500,
      lineHeight: 1.1,
      letterSpacing: 1,
    },
    h4: { fontFamily: order.headingFont, fontSize: 30, fontWeight: 500, lineHeight: 1.2 },
    h5: { fontFamily: order.headingFont, fontSize: 26, fontWeight: 500, lineHeight: 1.2 },
    h6: { fontFamily: order.headingFont, fontSize: 21, fontWeight: 500 },
    button: { fontSize: 12, textTransform: "none", fontWeight: 500 },
    body1: { fontSize: 13, lineHeight: 1.6 },
    body2: { fontSize: 12, lineHeight: 1.6 },
    caption: { fontSize: 11, lineHeight: 1.6 },
    overline: { fontSize: 11, lineHeight: 1.6 },
  },
  shape: { borderRadius: 0 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44,
          borderRadius: 0,
          "&.MuiButton-text.MuiButton-colorPrimary, &.MuiButton-outlined.MuiButton-colorPrimary": {
            color: order.metal,
          },
          "&.MuiButton-outlined.MuiButton-colorPrimary": { borderColor: order.controlBorder },
          "&.MuiButton-contained.MuiButton-colorPrimary": {
            padding: "10px 18px",
            background: order.buttonBackground,
            border: "1px solid #b77776",
            boxShadow: "inset 0 0 0 3px #692c35, inset 0 0 0 4px #bf999244",
            "&:hover": { background: "linear-gradient(#9b4551, #76303b)" },
            "&.Mui-disabled": {
              background: order.raised,
              boxShadow: "none",
              borderColor: order.border,
            },
          },
          "&.Mui-disabled": {
            color: order.muted,
            backgroundColor: order.raised,
            borderColor: order.border,
            boxShadow: "none",
          },
          "&.Mui-focusVisible": { outline: `3px solid ${order.focus}`, outlineOffset: 3 },
        },
      },
    },
    MuiCard: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: {
          position: "relative",
          background: order.panelBackground,
          borderColor: order.frame,
          boxShadow: `inset 0 0 0 5px #161519, inset 0 0 0 6px ${order.frameInset}, 0 12px 25px #00000033`,
          "&::before, &::after": {
            content: '""',
            position: "absolute",
            height: 27,
            width: 27,
            borderColor: order.frameCorner,
            borderStyle: "solid",
            pointerEvents: "none",
            opacity: 0.75,
          },
          "&::before": { top: 7, left: 7, borderWidth: "1px 0 0 1px" },
          "&::after": { right: 7, bottom: 7, borderWidth: "0 1px 1px 0" },
          minWidth: 0,
          overflowWrap: "anywhere",
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 29,
          "&:last-child": { paddingBottom: 29 },
          "@media (max-width: 599px)": {
            padding: "25px 18px",
            "&:last-child": { paddingBottom: 25 },
          },
        },
      },
    },
    MuiTextField: { defaultProps: { fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: order.raised,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: order.controlBorder },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: order.metal },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: order.focus },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: order.error },
        },
        input: {
          "&::placeholder": { color: order.muted, opacity: 1 },
          "@media (max-width: 599px)": { fontSize: 16 },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { "&.Mui-focused": { color: order.metal } } },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: order.controlBorder,
          "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: order.metal },
          "&.Mui-focusVisible": { outline: `3px solid ${order.focus}`, outlineOffset: 1 },
        },
      },
    },
    MuiTabs: { styleOverrides: { indicator: { backgroundColor: order.metal } } },
    MuiTab: {
      styleOverrides: {
        root: {
          color: order.muted,
          "&.Mui-selected": { color: order.metal },
          "&.Mui-focusVisible": { outline: `2px solid ${order.focus}`, outlineOffset: -3 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          height: "auto",
          minHeight: 25,
          maxWidth: "100%",
          fontSize: 11,
          "&.MuiChip-colorDefault": {
            backgroundColor: "#baaa8c0a",
            color: order.muted,
            border: "1px solid #59504a",
          },
        },
        label: { whiteSpace: "normal", overflowWrap: "anywhere", paddingTop: 3, paddingBottom: 3 },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          border: "1px solid",
          borderColor: "currentColor",
          "&.MuiAlert-standard.MuiAlert-colorInfo": {
            backgroundColor: `${order.metal}08`,
            borderColor: order.border,
            color: order.muted,
            "& .MuiAlert-icon": { color: order.metal },
          },
        },
      },
    },
    MuiCircularProgress: { styleOverrides: { colorPrimary: { color: order.metal } } },
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: "dark" },
        body: { margin: 0, background: order.contentBackground },
        "*": { boxSizing: "border-box" },
        ":focus-visible": { outline: `3px solid ${order.focus}`, outlineOffset: 3 },
        "::selection": { background: order.wax, color: order.text },
        select: {
          maxWidth: "100%",
          minWidth: 0,
          minHeight: 44,
          padding: "8px 12px",
          border: `1px solid ${order.controlBorder}`,
          borderRadius: 0,
          font: "inherit",
          fontSize: 13,
          background: order.raised,
          color: order.text,
          "@media (max-width: 599px)": { fontSize: 16 },
          "&:disabled": { color: order.muted, opacity: 1, cursor: "not-allowed" },
          "&:hover:not(:disabled)": { borderColor: order.metal },
        },
        summary: { cursor: "pointer", padding: "10px 0", fontWeight: 600 },
        a: { color: order.metal },
        pre: { maxWidth: "100%", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
        "h1, h2, h3, h4, h5, h6": {
          scrollMarginTop: 80,
          "@media (max-width: 899px)": { scrollMarginTop: 150 },
        },
        "@media (max-width: 599px)": {
          ".MuiTypography-h1, .MuiTypography-h3": { fontSize: 34 },
          ".MuiTypography-h2, .MuiTypography-h4": { fontSize: 28 },
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": { animation: "none !important", transition: "none !important" },
        },
      },
    },
  },
});

export function WorkspaceTheme({ children }: PropsWithChildren) {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles styles={fontStyles} />
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
