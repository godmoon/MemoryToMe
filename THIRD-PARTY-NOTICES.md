# 第三方数据声明

本项目自身代码以 [MIT License](LICENSE) 发布，但内置词库数据来自下列公开项目，遵循各自的许可。

## 语文教材词库

`server/seed/textbooks.json` 整理自：

- <https://github.com/lm16688/xiaoxuewordslearning>
- <https://github.com/7jul/yuwen_words>

仅供家庭听写练习使用。教材内容的著作权归原编者及出版机构所有，如需商用或公开分发，请自行确认授权。

## 英语词库

`server/seed/english.json` 整理自 KyleBing/english-vocabulary：

- 项目地址：<https://github.com/KyleBing/english-vocabulary>
- 使用范围：`full_line_tsv/simple/正序` 中的初中、高中、四级、六级、考研、人教小学三至六年级词表
- 处理方式：只保留单词、词性、精简后的中文释义，去除人名、地名等词典噪声

原项目许可以下：

```
BSD 3-Clause License

Copyright (c) 2022-2026, KyleBing

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
