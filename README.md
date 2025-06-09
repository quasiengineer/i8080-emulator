# i8080-emulator

Emulator with profiling and debug modes for Intel 8080.

Based on https://github.com/chris-j-akers/i8080-javascript.

Basic usage: `node index.js PATH_TO_RAM_IMAGE`

Few modifications that has been made:

## Output device

It's attached at port 0x01, and depending on input data would output:
1. Current host machine time, if input byte is `0x05`
2. Current tick count, if input byte is `0x06`
3. Byte itself in ASCII encoding, otherwise.

Assembly code to trigger output could be something like that:
```assembly
    # print current time on host machine
    ld      a, 0x05
    out     (1), a
```

## MMIO

Added 5-byte memory-mapped register, that contains tick counter `[0xF880 .. 0xF884]`.

Current value of tick counter could be retrieved that way:
```c
void storeTime(uint8_t * dst) {
   *dst = *(uint8_t *)0xF880;
   *(dst + 1) = *(uint8_t *)0xF881;
   *(dst + 2) = *(uint8_t *)0xF882;
   *(dst + 3) = *(uint8_t *)0xF883;
   *(dst + 4) = *(uint8_t *)0xF884;
}

void printTime(char * prefix, uint8_t * tm) {
   printf("%s: %02X%02X%02X%02X%02X ticks\n", prefix, *(tm + 4), *(tm + 3), *(tm + 2), *(tm + 1), *tm);
}
```

## Profiler

You need to have generated symbols map to retrieve list of stacktraces, this file should have same name as binary file, but with `.map` extension.

Example of symbols map:
```
fputc_cons_native               = $079A ; addr, public, , hal_asm, code_user, hal.asm:10
handle_percent                  = $06DA ; addr, local, , asm_printf, code_clib, stdio/asm_printf.asm:198
handlelong                      = $0001 ; const, local, , __printf_number, code_clib, stdio/__printf_number.asm:20
i_1                             = $07A3 ; addr, local, , main_c, rodata_compiler, main.c::main::0::3:19
```

To run emulator in profile mode you need just to pass `--profile` flag: `node index.js PATH_TO_RAM_IMAGE --profile`

Output would be in regular stacktraces format, that could be used to build flamegraph.
```
crt0_init_bss 3007
_main;_storeTime;l_gintspsp 134
_main;_storeTime 962
_main;printf;asm_printf;__printf_doprint;__printf_increment_chars_written 1624
_main;printf;asm_printf;__printf_doprint;__printf_get_fp 1204
_main;printf;asm_printf;__printf_doprint;__printf_get_print_function 1274
_main;printf;asm_printf;__printf_doprint;_fputc_callee;_wrapper_fputc_callee_8080;___fchkstd 1778
_main;printf;asm_printf;__printf_doprint;_fputc_callee;_wrapper_fputc_callee_8080;_fputc_cons 938
_main;printf;asm_printf;__printf_doprint;_fputc_callee;_wrapper_fputc_callee_8080 2380
_main;printf;asm_printf;__printf_doprint;_fputc_callee 952
_main;printf;asm_printf;__printf_doprint 2576
_main;printf;asm_printf 3017
_main;printf 228
_main;_printTime;l_gintspsp 134
_main;_printTime;l_gint6sp 108
_main;_printTime;l_gint8sp 108
_main;_printTime;l_gint 204
_main;_printTime;printf;asm_printf;__printf_get_flags;__printf_set_flags 1140
_main;_printTime;printf;asm_printf;__printf_get_flags;__printf_set_width 2354
_main;_printTime;printf;asm_printf;__printf_get_flags;__printf_set_precision 1284
...
```

## Debugger

To run emulator in profile mode you need to pass `--debug` flag: `node index.js PATH_TO_RAM_IMAGE --debug`.

You would have simple command interpreter, that supports commands:
- `bp ADDR` to set breakpoint on hexidecimal address
- `mrw ADDR` to read 16-bit word from memory
- `mr ADDR LEN` to read memory region
- `mrb ADDR` to read 8-bit byte from memory
- `regs` to output values of registers `SP`, `H`, `L,` `A`, `D` and `B`
- `run` to resume execution of program (in case if it has been stopped at breakpoint)
- `n` execute single instruction and stop (single-step debugging)