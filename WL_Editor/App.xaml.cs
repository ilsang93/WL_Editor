using System;
using System.Collections.Generic;
using System.Configuration;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;

namespace WL_Editor
{
    /// <summary>
    /// App.xaml에 대한 상호 작용 논리
    /// </summary>
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // 전역 예외 처리
            AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;
            DispatcherUnhandledException += App_DispatcherUnhandledException;

            // 애플리케이션 설정 초기화
            InitializeApplicationSettings();
        }

        private void InitializeApplicationSettings()
        {
            // 고화질 렌더링 설정
            RenderOptions.ProcessRenderMode = System.Windows.Interop.RenderMode.Default;

            // 텍스트 렌더링 옵션 설정 (선명한 텍스트를 위해)
            //TextOptions.SetTextFormattingMode(this.MainWindow, TextFormattingMode.Display);
            //TextOptions.SetTextRenderingMode(this.MainWindow, TextRenderingMode.ClearType);
        }

        private void App_DispatcherUnhandledException(object sender, System.Windows.Threading.DispatcherUnhandledExceptionEventArgs e)
        {
            MessageBox.Show($"애플리케이션에서 예외가 발생했습니다:\n\n{e.Exception.Message}",
                           "오류", MessageBoxButton.OK, MessageBoxImage.Error);

            // 예외를 처리했음을 표시하여 애플리케이션이 종료되지 않도록 함
            e.Handled = true;
        }

        private void CurrentDomain_UnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            var exception = e.ExceptionObject as Exception;
            MessageBox.Show($"심각한 오류가 발생했습니다:\n\n{exception?.Message}",
                           "심각한 오류", MessageBoxButton.OK, MessageBoxImage.Error);
        }

        protected override void OnExit(ExitEventArgs e)
        {
            // 애플리케이션 종료 시 정리 작업
            // MediaPlayer 정리는 MainWindow에서 개별적으로 처리됨

            base.OnExit(e);
        }
    }
}